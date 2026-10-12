// mf-guest-comms — the "WHAT" half: drafting personalised copy.
//
// MOONSHOT PRINCIPLE: this is the one genuinely LLM-shaped step — turning a
// guest's history/occasion/notes into warm, on-brand prose. It goes through
// runAgent TEXT-ONLY (no tools), the gateway key resolved settings-first inside
// the agent. EVERYTHING degrades gracefully: with no AI key (or any agent error)
// we fall back to a deterministic, perfectly-sendable template, so the engine
// always produces a queue-able draft and never blocks on the model.
//
// The model returns ONLY the body sentences; we slot them into the brand-tinted
// shell() (same look as the transactional emails) and derive a subject line.

import type { Customer, Restaurant } from '../db/types.js';
import type { CommsCandidate, CommsKind } from './types.js';
import { KIND_LABEL } from './types.js';

const LONDON = 'Europe/London';
const ACCENT: Record<string, string> = { asia: '#d4a04c', fusion: '#c45a3a' };

export interface DraftedMessage {
	subject: string;
	html: string;
	/** True when the LLM wrote the body; false when the deterministic fallback did
	 *  (no AI key, model error, or empty/over-long reply). Surfaced in the outbox. */
	aiGenerated: boolean;
}

/** Brand-tinted email shell — mirrors email/confirmations.ts so comms look native
 *  alongside the transactional mail. Self-contained (that shell isn't exported). */
export function shell(brandId: string, restaurantName: string, bodyHtml: string): string {
	const accent = ACCENT[brandId] ?? '#d4a04c';
	return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1a1f2b">
		<div style="border-top:4px solid ${accent};padding:24px 8px">
			<h1 style="font-size:20px;margin:0 0 4px">${restaurantName}</h1>
			${bodyHtml}
			<p style="font-size:12px;color:#8591a8;margin-top:28px">
				Geisha Restaurants · Front Street, Benton, Newcastle Upon Tyne, NE12 8AE
			</p>
		</div>
	</div>`;
}

/** Wrap raw body sentences (one paragraph each) into the shell, with a greeting. */
function wrapBody(
	brand: string,
	restaurantName: string,
	name: string,
	sentences: string[]
): string {
	const greeting = `<p style="font-size:15px">Hello ${escapeHtml(name) || 'there'},</p>`;
	const paras = sentences.map((s) => `<p style="font-size:15px">${escapeHtml(s)}</p>`).join('\n');
	const signoff = `<p style="font-size:13px;color:#6b7488">With warm regards,<br/>The team at ${escapeHtml(restaurantName)}</p>`;
	return shell(brand, restaurantName, `${greeting}\n${paras}\n${signoff}`);
}

/** Default subject per kind, personalised with the restaurant name. */
function subjectFor(kind: CommsKind, restaurantName: string): string {
	switch (kind) {
		case 'thank_you':
			return `Thank you for dining with us — ${restaurantName}`;
		case 'win_back':
			return `We'd love to welcome you back — ${restaurantName}`;
		case 'occasion':
			return `A little something for your celebration — ${restaurantName}`;
		case 'reminder':
			return `Looking forward to seeing you — ${restaurantName}`;
	}
}

/** Deterministic fallback body (no AI). Always warm + sendable. */
function fallbackSentences(candidate: CommsCandidate, restaurantName: string): string[] {
	const firstName = (candidate.customer.name || '').trim().split(/\s+/)[0] || '';
	void firstName; // greeting uses full handling in wrapBody
	switch (candidate.kind) {
		case 'thank_you':
			return [
				`Thank you so much for joining us at ${restaurantName} — it was a pleasure to host you.`,
				`We hope every dish hit the mark, and we'd be delighted to welcome you back soon.`
			];
		case 'win_back':
			return [
				`It's been a little while since your last visit to ${restaurantName}, and we've missed you.`,
				`We'd love to welcome you back — reply to this email or call us and we'll find you the perfect table.`
			];
		case 'occasion': {
			const occ = candidate.occasion ? candidate.occasion : 'celebration';
			return [
				`We're so pleased you've chosen ${restaurantName} for your ${occ}.`,
				`Let us know if there's anything we can do to make the occasion extra special — we'll take care of the rest.`
			];
		}
		case 'reminder':
			return [
				`Just a warm note to say we're looking forward to welcoming you to ${restaurantName} very soon.`,
				`If anything changes, simply reply to this email or give us a call.`
			];
	}
}

/**
 * Build the system + user prompt that asks the model for ONLY the body sentences.
 * History/occasion/notes are summarised deterministically and handed in — the
 * model never queries anything (text-only, no tools).
 */
function buildPrompt(
	candidate: CommsCandidate,
	restaurant: Restaurant,
	context: { visitCount: number; lastVisitLabel?: string; notesSnippet?: string }
): { system: string; user: string } {
	const brandName = restaurant.brand === 'fusion' ? 'Geisha Fusion' : 'Geisha Asia';
	const system =
		`You write short, warm, genuinely personal guest emails for ${brandName}, an upscale ` +
		`restaurant in Benton, Newcastle. Voice: friendly, sincere, a touch elegant — never gushing, ` +
		`pushy, salesy or robotic. British English. No emojis. Do NOT invent facts (no fake discounts, ` +
		`dates, dish names or claims). Reply with ONLY the email body as 2-3 short sentences of plain ` +
		`text (no greeting line, no sign-off, no subject, no markdown, no HTML) — those are added for you. ` +
		`If the guest has an allergy on file, you may gently remind them we'll always reconfirm their ` +
		`dietary needs on arrival, but NEVER give medical advice.`;

	const lines: string[] = [];
	lines.push(`Email type: ${KIND_LABEL[candidate.kind]} (${candidate.reason}).`);
	lines.push(`Guest name: ${candidate.customer.name || 'guest'}.`);
	lines.push(`Lifetime visits: ${context.visitCount}.`);
	if (context.lastVisitLabel) lines.push(`Last visit: ${context.lastVisitLabel}.`);
	if (candidate.occasion) lines.push(`Occasion: ${candidate.occasion}.`);
	if (candidate.booking?.party_size) lines.push(`Party size: ${candidate.booking.party_size}.`);
	if (candidate.customer.vip) lines.push(`This is a VIP regular.`);
	if (candidate.customer.allergies?.trim())
		lines.push(`Allergy on file: ${candidate.customer.allergies.trim().slice(0, 120)}.`);
	if (context.notesSnippet) lines.push(`Staff notes: ${context.notesSnippet}.`);

	return { system, user: lines.join('\n') };
}

/** Plain-text snippet from a (possibly HTML) notes field, capped for the prompt. */
function notesSnippet(notes: string | undefined): string | undefined {
	const text = (notes || '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text ? text.slice(0, 200) : undefined;
}

/**
 * Draft a message for one candidate. Tries the LLM (text-only); on ANY problem
 * falls back to the deterministic template. Always returns a complete, sendable
 * { subject, html }.
 *
 * @param history minimal stats about the guest (count + last-visit label) so the
 *                prompt is grounded without another query in this module.
 */
export async function draftMessage(
	candidate: CommsCandidate,
	restaurant: Restaurant,
	history: { visitCount: number; lastVisitISO?: string } = { visitCount: 0 }
): Promise<DraftedMessage> {
	const restaurantName = restaurant.display_name;
	const subject = subjectFor(candidate.kind, restaurantName);
	const name = candidate.customer.name || '';

	const context = {
		visitCount: history.visitCount,
		lastVisitLabel: history.lastVisitISO ? longDate(history.lastVisitISO) : undefined,
		notesSnippet: notesSnippet(candidate.customer.notes)
	};

	let sentences = fallbackSentences(candidate, restaurantName);
	let aiGenerated = false;

	try {
		const { runAgent, isConfiguredAsync } = await import('../ai/geminiAgent.js');
		if (await isConfiguredAsync()) {
			const { system, user } = buildPrompt(candidate, restaurant, context);
			const result = await runAgent(system, user, [], []);
			if (result.configured && !result.errored) {
				const body = sanitiseModelBody(result.answer);
				if (body.length) {
					sentences = body;
					aiGenerated = true;
				}
			}
		}
	} catch (err) {
		// Network / import / model error — keep the deterministic fallback.
		console.error('[comms] draftMessage LLM failed (using fallback):', err);
	}

	return {
		subject,
		html: wrapBody(restaurant.brand, restaurantName, name, sentences),
		aiGenerated
	};
}

/** Turn the model's plain-text reply into 1-3 clean sentences/paragraphs. Drops
 *  anything that looks like leaked HTML/markdown or an over-long ramble. */
export function sanitiseModelBody(answer: string): string[] {
	const cleaned = (answer || '')
		.replace(/```[\s\S]*?```/g, ' ') // strip code fences
		.replace(/<[^>]+>/g, ' ') // strip any stray HTML
		.replace(/^\s*(subject|hello|hi|dear)\b.*$/gim, '') // drop a leaked greeting/subject line
		.replace(/\r/g, '')
		.trim();
	if (!cleaned) return [];
	// Split into paragraphs (blank line) or fall back to the whole thing as one.
	const paras = cleaned
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
	const out = (paras.length ? paras : [cleaned.replace(/\s+/g, ' ').trim()]).slice(0, 3);
	// Guard against a runaway reply: cap each paragraph length.
	return out.map((p) => (p.length > 600 ? p.slice(0, 600).trimEnd() + '…' : p));
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function longDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: LONDON
	});
}
