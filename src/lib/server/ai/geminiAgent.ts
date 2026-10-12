// Function-calling agent loop. Shared by the guest assistant (one read-only
// tool) and the admin assistant (read tools + confirm-gated writes + UI
// "widget" directives). Carries the safety model of the retired Claude stack:
//
//   - READ tools run automatically and feed their results back to the model.
//   - WRITE tools are NOT executed here. The first one the model asks for stops
//     the loop and is returned as a `proposedAction` for the caller to confirm.
//   - UI tools (kind:'ui') don't touch data — they run and their output is sent
//     back to the model AND surfaced to the caller as a `directive` so the UI can
//     react (e.g. spawn setting widgets beside the chat).
//
// Transport: the Vercel AI Gateway's OpenAI-compatible Chat Completions REST
// endpoint (no SDK). One key (AI_GATEWAY_API_KEY) fronts any provider/model via
// the AI_MODEL "provider/model" id. The agent keeps a small Gemini-style
// internal Content/Part model and converts to/from OpenAI shape per request, so
// the whole tool loop below is transport-agnostic.

import { env } from '$env/dynamic/private';
import { validateToolInput } from './validateToolInput.js';

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

// Default gateway model. Override with AI_MODEL ("provider/model"), e.g.
// google/gemini-2.5-flash or openai/gpt-4.1-mini.
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

/**
 * Resolve the AI Gateway API key: staff-entered geisha_settings value first
 * (key 'ai_gateway_api_key'), then env.AI_GATEWAY_API_KEY, else ''.
 */
async function gatewayKey(): Promise<string> {
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		return await getIntegrationKeyAny('ai_gateway_api_key');
	} catch {
		return env.AI_GATEWAY_API_KEY ?? '';
	}
}

/** Resolve the model id: settings ('ai_model') → env.AI_MODEL → DEFAULT_MODEL. */
async function gatewayModel(): Promise<string> {
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		const v = await getIntegrationKeyAny('ai_model');
		if (v) return v;
	} catch {
		// fall through to env / default
	}
	return env.AI_MODEL || DEFAULT_MODEL;
}

/** Sync best-effort check (env only) — kept for callers that can't await. */
export function isConfigured(): boolean {
	return Boolean(env.AI_GATEWAY_API_KEY);
}

/** True once a gateway key is configured (settings or env). Prefer this. */
export async function isConfiguredAsync(): Promise<boolean> {
	return Boolean(await gatewayKey());
}

export type ToolKind = 'read' | 'write' | 'ui';

export interface GeminiTool {
	name: string;
	description: string;
	kind: ToolKind;
	/** JSON-schema-ish parameter spec (Gemini "OpenAPI subset"). */
	parameters: Record<string, unknown>;
	/** `onBehalfOf` (optional) is the confirming staff id, threaded by confirmTool
	 *  for the audit row; read-tool runs and existing closures ignore it. */
	run: (input: any, onBehalfOf?: string) => Promise<unknown>;
}

/** A directive the UI should act on (e.g. open setting widgets). */
export interface UiDirective {
	tool: string;
	input: unknown;
	result: unknown;
}

export interface AgentResult {
	configured: boolean;
	answer: string;
	/** True when `answer` is a technical failure notice (e.g. rate-limit). Lets a
	 *  public caller substitute a friendlier line while admin sees the detail. */
	errored?: boolean;
	/** A write the agent wants to perform, awaiting confirmation. */
	proposedAction?: { tool: string; input: unknown; description: string };
	/** UI directives produced this turn (e.g. spawn-widget). */
	directives: UiDirective[];
	toolsUsed: string[];
}

export interface ChatTurn {
	role: 'user' | 'assistant';
	content: string;
}

type Part =
	| { text: string }
	| { functionCall: { id?: string; name: string; args: Record<string, unknown> } }
	| { functionResponse: { id?: string; name: string; response: Record<string, unknown> } };

interface Content {
	role: 'user' | 'model';
	parts: Part[];
}

/** A model-call failure carrying a short, admin-facing explanation. */
class GeminiError extends Error {
	constructor(public userMessage: string) {
		super(userMessage);
	}
}

/** Pull a suggested retry delay (seconds) from a 429/503 error body, if present
 *  (gateways/providers commonly include "retry in 12s" or a retryDelay field). */
function retryAfterSeconds(body: string): number | null {
	const m =
		body.match(/retry(?: in|-after)[:\s]+([\d.]+)s?/i) ?? body.match(/"retryDelay":\s*"([\d.]+)s"/i);
	return m ? Number(m[1]) : null;
}

/** Map an HTTP status + error body to a short, specific admin-facing message. */
function classifyError(status: number, body: string, model: string): string {
	const retry = retryAfterSeconds(body);
	switch (status) {
		case 429:
			return `the assistant is busy (rate limit hit)${
				retry != null
					? ` — please wait ~${Math.ceil(retry)}s and try again`
					: ' — please try again in a moment'
			}.`;
		case 400:
			return 'The AI Gateway rejected the request (400 — bad request).';
		case 401:
		case 403:
			return 'AI Gateway auth failed (check AI_GATEWAY_API_KEY).';
		case 402:
			return 'The AI Gateway request was declined (402 — out of credits / billing).';
		case 404:
			return `Model "${model}" was not found (404) — set AI_MODEL to a valid "provider/model" id (e.g. anthropic/claude-haiku-4.5).`;
		case 500:
		case 502:
		case 503:
			return 'The AI Gateway is temporarily unavailable (server error) — please try again in a moment.';
		default:
			return `AI Gateway request failed (HTTP ${status}).`;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Statuses worth a quick retry: transient server errors and rate limits. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// --- OpenAI <-> internal Content/Part conversion -------------------------
//
// The loop below speaks a small Gemini-style Content/Part model. The gateway
// speaks OpenAI Chat Completions. These helpers translate each way. Tool calls
// need a stable id to pair a call with its result; we synthesise deterministic
// ids ("call_<turn>_<n>") when the model's reply doesn't carry one.

type OpenAIMessage =
	| { role: 'system' | 'user' | 'assistant'; content: string }
	| {
			role: 'assistant';
			content: string | null;
			tool_calls: Array<{
				id: string;
				type: 'function';
				function: { name: string; arguments: string };
			}>;
	  }
	| { role: 'tool'; tool_call_id: string; content: string };

/** Convert the internal conversation (system + Content[]) to OpenAI messages. */
function toOpenAIMessages(system: string, contents: Content[]): OpenAIMessage[] {
	const messages: OpenAIMessage[] = [{ role: 'system', content: system }];

	// Track which model-turn we're on so the fallback id matches the scheme used
	// in fromOpenAIMessage (`call_<turn>_<n>`). A call and its result MUST share
	// the same tool_call_id or the gateway rejects the follow-up request — the old
	// `call_<n>` fallback here disagreed with `call_<turn>_<n>` produced on parse.
	let modelTurn = 0;

	for (const c of contents) {
		const text = c.parts
			.map((p) => ('text' in p ? p.text : ''))
			.join('')
			.trim();

		// Tool results: each functionResponse part becomes its own `tool` message.
		const responses = c.parts.filter(
			(p): p is Extract<Part, { functionResponse: unknown }> => 'functionResponse' in p
		);
		if (responses.length) {
			for (const r of responses) {
				messages.push({
					role: 'tool',
					tool_call_id: r.functionResponse.id ?? r.functionResponse.name,
					content: JSON.stringify(r.functionResponse.response ?? null)
				});
			}
			continue;
		}

		// Assistant turn that asked for tools.
		const calls = c.parts.filter(
			(p): p is Extract<Part, { functionCall: unknown }> => 'functionCall' in p
		);
		if (c.role === 'model' && calls.length) {
			const turn = modelTurn++;
			messages.push({
				role: 'assistant',
				content: text || null,
				tool_calls: calls.map((p, i) => ({
					id: p.functionCall.id ?? `call_${turn}_${i}`,
					type: 'function',
					function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) }
				}))
			});
			continue;
		}

		if (c.role === 'model') modelTurn++;
		messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text });
	}

	return messages;
}

/** Convert an OpenAI choice message back into an internal model Content. */
function fromOpenAIMessage(
	msg: {
		content?: string | null;
		tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
	} | null,
	turn: number
): Content | null {
	if (!msg) return null;
	const parts: Part[] = [];
	if (msg.content) parts.push({ text: msg.content });
	(msg.tool_calls ?? []).forEach((tc, i) => {
		let args: Record<string, unknown> = {};
		try {
			args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
		} catch {
			args = {};
		}
		parts.push({
			functionCall: { id: tc.id ?? `call_${turn}_${i}`, name: tc.function?.name ?? '', args }
		});
	});
	return { role: 'model', parts };
}

/** One gateway request attempt. Throws GeminiError (with `.status`) on failure. */
async function attempt(
	body: Record<string, unknown>,
	model: string,
	turn: number,
	key: string
): Promise<Content | null> {
	let res: Response;
	try {
		res = await fetch(GATEWAY_URL, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${key}`
			},
			body: JSON.stringify(body)
		});
	} catch {
		throw Object.assign(
			new GeminiError('Couldn’t reach the AI Gateway (network error) — please try again.'),
			{ status: 0 }
		);
	}

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		console.error('[aiAgent] gateway request failed', res.status, detail.slice(0, 600));
		throw Object.assign(new GeminiError(classifyError(res.status, detail, model)), {
			status: res.status,
			retryAfter: retryAfterSeconds(detail)
		});
	}
	const data = (await res.json().catch(() => null)) as {
		choices?: Array<{ message?: Parameters<typeof fromOpenAIMessage>[0] }>;
	} | null;
	return fromOpenAIMessage(data?.choices?.[0]?.message ?? null, turn);
}

async function callGemini(
	system: string,
	contents: Content[],
	tools: GeminiTool[],
	turn = 0
): Promise<Content | null> {
	// Resolve the model + key settings-first (env fallback inside each resolver).
	const model = await gatewayModel();
	const key = await gatewayKey();

	const body: Record<string, unknown> = {
		model,
		messages: toOpenAIMessages(system, contents),
		temperature: 0.3,
		// Raised 1024→2048: multi-tool turns (e.g. a diary summary plus a proposed
		// write, or a settings walkthrough) were occasionally truncated mid-answer.
		max_tokens: 2048
	};
	if (tools.length) {
		body.tools = tools.map((t) => ({
			type: 'function',
			function: { name: t.name, description: t.description, parameters: t.parameters }
		}));
	}

	// Up to 3 attempts on transient 5xx/429 so a rate-limit blip on a follow-up
	// turn doesn't lose the whole reply. Honour the API's own retry delay when it
	// gives one, but CAP the wait — a chat shouldn't hang for the API's full
	// "retry in 32s"; past the cap we give up and surface a friendly notice.
	const MAX_WAIT_MS = 6000;
	let lastErr: unknown;
	for (let i = 0; i < 3; i++) {
		try {
			return await attempt(body, model, turn, key);
		} catch (e) {
			lastErr = e;
			const status = (e as { status?: number }).status ?? 0;
			const isLast = i === 2;
			if (isLast || !RETRYABLE.has(status)) throw e;
			const suggested = (e as { retryAfter?: number | null }).retryAfter;
			const waitMs = suggested != null ? suggested * 1000 : 800 * (i + 1); // backoff
			if (waitMs > MAX_WAIT_MS) throw e; // too long to block — bail with the message
			await sleep(waitMs);
		}
	}
	throw lastErr;
}

function textOf(content: Content | null): string {
	// `parts` can be absent (e.g. a safety-blocked or empty model turn).
	if (!content?.parts) return '';
	return content.parts
		.map((p) => ('text' in p ? p.text : ''))
		.join('')
		.trim();
}

function callsOf(content: Content | null) {
	if (!content?.parts)
		return [] as Array<{ id?: string; name: string; args: Record<string, unknown> }>;
	return content.parts
		.filter((p): p is Extract<Part, { functionCall: unknown }> => 'functionCall' in p)
		.map((p) => p.functionCall);
}

/**
 * Run a bounded function-calling loop.
 *
 * @param system   System instruction.
 * @param message  The new user message.
 * @param history  Prior plain-text turns (oldest first).
 * @param tools    Available tools.
 */
export async function runAgent(
	system: string,
	message: string,
	history: ChatTurn[],
	tools: GeminiTool[]
): Promise<AgentResult> {
	if (!(await isConfiguredAsync())) {
		return {
			configured: false,
			answer:
				'The assistant isn’t switched on yet (add an AI Gateway key in Settings → Integrations, or set AI_GATEWAY_API_KEY). All tools are wired and ready — it will work as soon as the key is added.',
			directives: [],
			toolsUsed: []
		};
	}

	const byName = new Map(tools.map((t) => [t.name, t]));
	const contents: Content[] = [
		...history.slice(-16).map<Content>((t) => ({
			role: t.role === 'assistant' ? 'model' : 'user',
			parts: [{ text: t.content }]
		})),
		{ role: 'user', parts: [{ text: message }] }
	];

	const toolsUsed: string[] = [];
	const directives: UiDirective[] = [];

	for (let turn = 0; turn < 10; turn++) {
		let reply: Content | null;
		try {
			reply = await callGemini(system, contents, tools, turn);
		} catch (e) {
			// Surface the specific reason (rate-limit, auth, bad model, …).
			return {
				configured: true,
				errored: true,
				answer:
					e instanceof GeminiError
						? `Sorry — ${e.userMessage}`
						: 'Sorry — I couldn’t complete that just now. Please try again.',
				directives,
				toolsUsed
			};
		}
		if (!reply) {
			return {
				configured: true,
				answer: 'Sorry — I didn’t get a response from the model. Please try again.',
				directives,
				toolsUsed
			};
		}

		const calls = callsOf(reply);
		if (calls.length === 0) {
			const text = textOf(reply);
			return {
				configured: true,
				answer: text || 'Sorry — I didn’t catch that. Could you rephrase?',
				directives,
				toolsUsed
			};
		}

		// record the model's function-call turn verbatim
		contents.push(reply);

		// Run ALL read/ui tools in this batch FIRST, then halt on the first write.
		// The previous version early-returned the moment it hit a write, discarding
		// any read results already computed earlier in the same batch (the model
		// then re-asked for them, wasting turns). Now reads always feed back and a
		// pending write is surfaced AFTER, so its confirmation resumes with the
		// reads already in context.
		const responses: Part[] = [];
		let pendingWrite: { def: GeminiTool; call: (typeof calls)[number] } | null = null;

		for (const call of calls) {
			const def = byName.get(call.name);
			toolsUsed.push(call.name);

			if (!def) {
				responses.push({
					functionResponse: { id: call.id, name: call.name, response: { error: 'unknown tool' } }
				});
				continue;
			}

			// WRITE guardrail: don't execute. Remember the FIRST write and keep going
			// so the rest of the read batch still runs and is fed back.
			if (def.kind === 'write') {
				if (!pendingWrite) pendingWrite = { def, call };
				responses.push({
					functionResponse: {
						id: call.id,
						name: call.name,
						response: { status: 'awaiting_confirmation' }
					}
				});
				continue;
			}

			try {
				const output = await def.run(call.args);
				if (def.kind === 'ui') {
					directives.push({ tool: def.name, input: call.args, result: output });
				}
				responses.push({
					functionResponse: {
						id: call.id,
						name: call.name,
						response: { result: JSON.parse(JSON.stringify(output ?? null)) }
					}
				});
			} catch (err) {
				responses.push({
					functionResponse: {
						id: call.id,
						name: call.name,
						response: { error: err instanceof Error ? err.message : 'tool failed' }
					}
				});
			}
		}

		// Feed the batch's results back (reads + ui + any awaiting-confirmation
		// stubs) so nothing is dropped, THEN surface the pending write.
		contents.push({ role: 'user', parts: responses });

		if (pendingWrite) {
			const { def, call } = pendingWrite;
			return {
				configured: true,
				answer:
					textOf(reply) ||
					`I’d like to ${def.description.split('.')[0].toLowerCase()}. Please confirm to proceed.`,
				proposedAction: { tool: def.name, input: call.args, description: def.description },
				directives,
				toolsUsed
			};
		}
	}

	return {
		configured: true,
		answer: 'Sorry — I couldn’t finish that in time. Could you narrow the request?',
		directives,
		toolsUsed
	};
}

/**
 * Execute a previously-proposed write tool after the user confirms it, and
 * return its result.
 *
 * RESUME / RE-FEED: the returned value is the tool's output. To continue the
 * conversation with the model AWARE of the write, the caller feeds this result
 * back as the next turn — append an assistant line summarising the confirmed
 * action (e.g. "Done — moved booking to T4.") to `history` and call
 * {@link runAgent} again. Because the loop now (a) keeps the last 16 history
 * turns and (b) no longer drops reads run alongside a write, the model resumes
 * with its earlier context intact instead of re-gathering it.
 *
 * RE-VALIDATION (WP-S1-2): the confirm payload is client-supplied, so before we
 * run the write we re-check `input` against the tool's OWN declared `parameters`
 * (the same schema the model is constrained by at call time). This rejects a
 * confirmed write that arrives with a wrong-typed / missing / unexpected field
 * (e.g. move_booking with a string instead of a string[] for tableIds) BEFORE
 * run() touches the DB. The route gates the confirm behind requireRole(host+);
 * `onBehalfOf` is the confirming staff id, threaded forward for the audit row.
 *
 * Back-compat: `onBehalfOf` is optional, so existing callers that only pass
 * (tools, name, input) and only use the returned result keep working.
 */
export async function confirmTool(
	tools: GeminiTool[],
	name: string,
	input: unknown,
	onBehalfOf?: string
): Promise<unknown> {
	const def = tools.find((t) => t.name === name);
	if (!def || def.kind !== 'write') throw new Error('Not a confirmable write action.');
	const check = validateToolInput(def.parameters, input);
	if (!check.ok) throw new Error(`Invalid input for ${name}: ${check.errors.join('; ')}`);
	return def.run(check.value, onBehalfOf);
}
