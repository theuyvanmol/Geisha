// Transactional email (BOOKING_SYSTEM_PLAN.md §5).
//
// TWO PROVIDERS, ONE send(). Brevo is preferred; Resend is the fallback. Which
// one runs is decided per call from whichever key is configured, so moving the
// client's mail to Brevo is a key swap in admin Settings — no deploy, and
// instantly reversible by clearing the Brevo key.
//
// GRACEFUL NO-KEY MODE: with NEITHER key set, isConfigured() is false and send()
// logs the email instead of dispatching, so the booking flow is complete in dev
// and goes live the moment a key is added. Both providers are called over plain
// REST (no SDK dependency).

import { env } from '$env/dynamic/private';
import type { MessageStatus } from '../db/types.js';
import { sendViaBrevo } from './brevo.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const DEFAULT_FROM = 'Geisha Restaurants <bookings@geisharestaurants.co.uk>';

// PERF: cache the resolved key + from-address at module scope for a short TTL.
// getIntegrationKeyAny() does a getFullList on geisha_settings PER CALL — and
// send() previously resolved BOTH on every email, so each of the (best-effort,
// often no-op) confirmation emails on the booking write path cost 2 extra PB
// round-trips even when Resend is unconfigured and nothing is actually sent.
// The credential changes at most a few times a year, so a 60s memo is safe and
// removes those two round-trips from the mutation critical path in the common case.
const KEY_TTL_MS = 60_000;
let _keyCache: { value: Transport; at: number } | null = null;
let _fromCache: { value: string; at: number } | null = null;
let _replyToCache: { value: string; at: number } | null = null;

/** Which provider a send will actually use, and the key it will use. */
type Transport = { provider: 'brevo' | 'resend' | 'none'; key: string };

const NO_TRANSPORT: Transport = { provider: 'none', key: '' };

/**
 * Resolve the active transport: Brevo if a key is configured, else Resend, else
 * none. Each key resolves settings-first (geisha_settings), then env.
 *
 * Memoised for KEY_TTL_MS. getIntegrationKeyAny does a getFullList on
 * geisha_settings PER CALL, and send() would otherwise pay that on every
 * (best-effort, often no-op) confirmation email on the booking write path.
 */
async function transport(): Promise<Transport> {
	if (_keyCache && Date.now() - _keyCache.at < KEY_TTL_MS) return _keyCache.value;

	let value = NO_TRANSPORT;
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		const brevo = (await getIntegrationKeyAny('brevo_api_key')).trim();
		if (brevo) value = { provider: 'brevo', key: brevo };
		else {
			const resend = (await getIntegrationKeyAny('resend_api_key')).trim();
			if (resend) value = { provider: 'resend', key: resend };
		}
	} catch {
		// PocketBase unreachable — env only, same precedence.
		const brevo = (env.BREVO_API_KEY ?? '').trim();
		const resend = (env.RESEND_API_KEY ?? '').trim();
		if (brevo) value = { provider: 'brevo', key: brevo };
		else if (resend) value = { provider: 'resend', key: resend };
	}

	_keyCache = { value, at: Date.now() };
	return value;
}

/** Resolve the Reply-To applied to every email when the caller sets none.
 *  Empty = don't set one (replies go to the From address). */
async function defaultReplyTo(): Promise<string> {
	if (_replyToCache && Date.now() - _replyToCache.at < KEY_TTL_MS) return _replyToCache.value;
	let value = (env.EMAIL_REPLY_TO ?? '').trim();
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		const v = await getIntegrationKeyAny('email_reply_to');
		if (v) value = v;
	} catch {
		// keep the env / empty
	}
	_replyToCache = { value, at: Date.now() };
	return value;
}

/** Resolve the From address: settings ('email_from') → env → brand-neutral default.
 *  Memoised for KEY_TTL_MS (same rationale as {@link transport}).
 *
 *  Exported as {@link configuredFrom} so the guest templates can keep the
 *  configured ADDRESS (which must stay on the domain authenticated at the
 *  provider) while substituting the restaurant's own display name. */
export async function configuredFrom(): Promise<string> {
	return fromAddress();
}

async function fromAddress(): Promise<string> {
	if (_fromCache && Date.now() - _fromCache.at < KEY_TTL_MS) return _fromCache.value;
	let value = env.EMAIL_FROM ?? DEFAULT_FROM;
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		const v = await getIntegrationKeyAny('email_from');
		if (v) value = v;
	} catch {
		// keep the env / default
	}
	_fromCache = { value, at: Date.now() };
	return value;
}

/** Sync best-effort check (env only) — kept for callers that can't await. */
export function isConfigured(): boolean {
	return Boolean(env.BREVO_API_KEY || env.RESEND_API_KEY);
}

/** True once an email key is configured (settings or env). Prefer this. */
export async function isConfiguredAsync(): Promise<boolean> {
	return (await transport()).provider !== 'none';
}

/** Which provider would send right now — for the admin diagnostics panel. */
export async function activeProvider(): Promise<'brevo' | 'resend' | 'none'> {
	return (await transport()).provider;
}

export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	/**
	 * text/plain alternative. Optional only because a few callers (the AI comms
	 * drafter, the staff briefing) build HTML directly — everything rendered
	 * through email/layout.ts supplies one.
	 *
	 * Worth supplying. A transactional email with no plain-text part is a known
	 * spam signal, and it is also what a watch, a screen reader, or a client with
	 * images off actually reads.
	 */
	text?: string;
	/** Defaults to the brand-neutral Geisha sender. */
	from?: string;
	/**
	 * Where a reply should go when that isn't `from`. Used by the contact-form
	 * notification, which is sent BY us but is really from the guest — without
	 * this, hitting Reply mails our own bookings inbox instead of them.
	 *
	 * When unset, the configured default (email_reply_to) is applied, so guest
	 * replies to a booking confirmation reach a monitored inbox rather than a
	 * no-reply sender the restaurant never checks.
	 */
	replyTo?: string;
	/** Provider-side labels for filtering in the dashboard (Brevo only). */
	tags?: string[];
}

/**
 * Send an email through the active provider (Brevo, else Resend). Returns
 * { sent: boolean } — false (with a log) when neither is configured. Never
 * throws on a delivery failure: email is best-effort, and a booking must not
 * fail because a confirmation bounced.
 *
 * NOTE what `sent: true` does and doesn't mean. It means the provider ACCEPTED
 * the message. Both providers reject an unauthenticated sender domain
 * asynchronously, so a run of accepted-but-undelivered mail looks perfect from
 * here and only shows up in the provider's own log. That is why the DNS records
 * matter before the changeover, not after.
 */
export async function send(msg: EmailMessage): Promise<{ sent: boolean; id?: string }> {
	const { provider, key } = await transport();
	if (provider === 'none') {
		// Resolve the from-address only when we're actually going to send — in no-key
		// mode there's nothing to send, so skip the extra settings read entirely.
		console.warn(
			`[email] no provider key set (brevo_api_key / resend_api_key, settings or env) — would send to ${msg.to}: "${msg.subject}"`
		);
		return { sent: false };
	}

	const from = msg.from ?? (await fromAddress());
	const replyTo = (msg.replyTo ?? (await defaultReplyTo())) || undefined;

	if (provider === 'brevo') {
		const result = await sendViaBrevo({ ...msg, from, replyTo }, key);
		if (!result.sent) console.error(`[email] ${result.error ?? 'Brevo send failed'}`);
		return { sent: result.sent, id: result.id };
	}

	try {
		const res = await fetch(RESEND_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from,
				to: msg.to,
				subject: msg.subject,
				html: msg.html,
				...(msg.text ? { text: msg.text } : {}),
				...(replyTo ? { reply_to: replyTo } : {})
			})
		});
		if (!res.ok) {
			console.error(`[email] Resend ${res.status}: ${await res.text().catch(() => '')}`);
			return { sent: false };
		}
		const data = (await res.json()) as { id?: string };
		return { sent: true, id: data.id };
	} catch (err) {
		console.error('[email] send failed:', err);
		return { sent: false };
	}
}

/** Fields needed to log an outbound email to geisha_messages. */
export interface MessageLog {
	customer: string; // -> Customer.id (required by the collection)
	booking?: string; // -> Booking.id (optional; some messages are customer-level)
	template: string; // e.g. 'reminder' | 'confirmation'
}

/**
 * Best-effort write of a delivery row to geisha_messages. NEVER throws — message
 * logging must not break an email send or a cron sweep. `status` is the outcome
 * ('sent' | 'failed' | 'skipped' | …); `sent_at` is stamped for 'sent'/'delivered'.
 */
export async function logMessage(
	msg: EmailMessage,
	meta: MessageLog,
	status: MessageStatus
): Promise<void> {
	try {
		const { pb } = await import('../db/pb.js');
		const c = await pb();
		await c.collection('geisha_messages').create({
			booking: meta.booking ?? '',
			customer: meta.customer,
			channel: 'email',
			template: meta.template,
			status,
			subject: msg.subject,
			body: msg.html,
			scheduled_for: '',
			sent_at: status === 'sent' || status === 'delivered' ? new Date().toISOString() : ''
		});
	} catch (err) {
		console.error('[email] logMessage failed (non-fatal):', err);
	}
}

/**
 * Send an email AND record the outcome to geisha_messages in one call. Returns
 * the same shape as {@link send}. Maps a failed/no-key send to a 'failed' log row
 * and a successful send to 'sent'. Use this from flows that want a delivery audit
 * trail (e.g. the reminder cron); plain {@link send} stays log-free for callers
 * that don't have a customer id or don't need the trail.
 */
export async function sendAndLog(
	msg: EmailMessage,
	meta: MessageLog
): Promise<{ sent: boolean; id?: string }> {
	const result = await send(msg);
	await logMessage(msg, meta, result.sent ? 'sent' : 'failed');
	return result;
}
