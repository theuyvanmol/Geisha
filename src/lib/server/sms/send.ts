// Transactional SMS via a provider-agnostic HTTP adapter (sibling of email/send.ts).
//
// GRACEFUL NO-KEY MODE: until an SMS provider key is configured, smsConfigured()
// is false and sendSms() logs the attempt instead of dispatching, returning
// { sent: false, skipped: true } — EXACTLY like email send.ts no-ops when Resend
// is unset. This keeps the booking/reminder flows complete in dev and goes live
// the moment the key is added.
//
// PROVIDER-AGNOSTIC: we POST a generic { from, to, body } JSON payload with a
// Bearer key to a configurable endpoint, behind a tiny adapter. Most modern SMS
// HTTP APIs (and the ResDiary core-common SMS shape) fit this; swap the endpoint
// / payload mapping in one place if a provider needs a different envelope.

import { env } from '$env/dynamic/private';
import type { MessageStatus } from '../db/types.js';

/**
 * Default SMS HTTP endpoint. Overridable via the SMS_API_URL env var so the same
 * adapter can target whichever provider the account uses without a code change.
 */
const DEFAULT_ENDPOINT = 'https://api.sms-provider.example/v1/messages';

function endpoint(): string {
	const v = env.SMS_API_URL;
	return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_ENDPOINT;
}

/**
 * Resolve the SMS provider API key: staff-entered geisha_settings value first
 * (key 'sms_api_key'), then env.SMS_API_KEY, else ''.
 */
async function apiKey(): Promise<string> {
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		return await getIntegrationKeyAny('sms_api_key');
	} catch {
		return env.SMS_API_KEY ?? '';
	}
}

/** Resolve the sender id / number: settings ('sms_from') → env.SMS_FROM → ''. */
async function fromNumber(): Promise<string> {
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		const v = await getIntegrationKeyAny('sms_from');
		if (v) return v;
	} catch {
		// fall through to env
	}
	return env.SMS_FROM ?? '';
}

/** Sync best-effort check (env only) — kept for callers that can't await. */
export function isConfigured(): boolean {
	return Boolean(env.SMS_API_KEY);
}

/** True once an SMS provider key is configured (settings or env). Prefer this. */
export async function smsConfigured(): Promise<boolean> {
	return Boolean(await apiKey());
}

export interface SmsMessage {
	to: string;
	body: string;
	/** Override the configured sender id/number (rarely needed). */
	from?: string;
}

export interface SmsResult {
	sent: boolean;
	/** True when no provider key was configured and the send was a graceful no-op. */
	skipped?: boolean;
	id?: string;
}

/**
 * Send an SMS via the configured HTTP provider. Returns { sent, skipped?, id? }:
 *   - { sent: false, skipped: true } when no key is configured (graceful no-op)
 *   - { sent: false } on a delivery failure (never throws — SMS is best-effort,
 *     a booking/reminder must not fail because a text bounced)
 *   - { sent: true, id } on success.
 */
export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
	const key = await apiKey();
	const from = msg.from ?? (await fromNumber());

	if (!key) {
		console.warn(`[sms] provider key not set (settings or env) — would send to ${msg.to}: "${msg.body}"`);
		return { sent: false, skipped: true };
	}

	try {
		const res = await fetch(endpoint(), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${key}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ from, to: msg.to, body: msg.body })
		});
		if (!res.ok) {
			console.error(`[sms] provider ${res.status}: ${await res.text().catch(() => '')}`);
			return { sent: false };
		}
		const data = (await res.json().catch(() => ({}))) as { id?: string };
		return { sent: true, id: data.id };
	} catch (err) {
		console.error('[sms] send failed:', err);
		return { sent: false };
	}
}

/** Fields needed to log an outbound SMS to geisha_messages. */
export interface SmsMessageLog {
	customer: string; // -> Customer.id (required by the collection)
	booking?: string; // -> Booking.id (optional; some messages are customer-level)
	template: string; // e.g. 'reminder'
}

/**
 * Best-effort write of an SMS delivery row to geisha_messages (channel 'sms').
 * NEVER throws — message logging must not break a send or a cron sweep. Mirrors
 * the shape email send.ts uses; `subject` is left empty for SMS, `body` carries
 * the text. `sent_at` is stamped only for 'sent'/'delivered'.
 */
export async function logSms(
	msg: SmsMessage,
	meta: SmsMessageLog,
	status: MessageStatus
): Promise<void> {
	try {
		const { pb } = await import('../db/pb.js');
		const c = await pb();
		await c.collection('geisha_messages').create({
			booking: meta.booking ?? '',
			customer: meta.customer,
			channel: 'sms',
			template: meta.template,
			status,
			subject: '',
			body: msg.body,
			scheduled_for: '',
			sent_at: status === 'sent' || status === 'delivered' ? new Date().toISOString() : ''
		});
	} catch (err) {
		console.error('[sms] logSms failed (non-fatal):', err);
	}
}

/**
 * Send an SMS AND record the outcome to geisha_messages in one call. Maps a
 * no-key send to a 'skipped' log row, a delivery failure to 'failed', and a
 * successful send to 'sent'. Returns the same shape as {@link sendSms}. Use this
 * from flows that want a delivery audit trail (e.g. the reminder sweep).
 */
export async function sendAndLogSms(
	msg: SmsMessage,
	meta: SmsMessageLog
): Promise<SmsResult> {
	const result = await sendSms(msg);
	const status: MessageStatus = result.sent ? 'sent' : result.skipped ? 'skipped' : 'failed';
	await logSms(msg, meta, status);
	return result;
}
