// mf-guest-comms — the engine: glue between the PURE selector (select.ts), the
// LLM drafter (draft.ts) and the geisha_messages outbox.
//
// FLOW (per brand, per sweep):
//   1. resolve per-kind config from geisha_settings (enabled / autoSend).
//   2. fetch a recent window of bookings (customer expanded) + recent messages.
//   3. run the enabled selectors → candidates (deterministic, see select.ts).
//   4. drop candidates already touched for that kind (IDEMPOTENT) + drop
//      marketing kinds without marketing_consent (GDPR).
//   5. draft copy (LLM text-only, deterministic fallback) and CREATE a
//      geisha_messages row: status 'draft' (review-first) or — when the kind is
//      auto-send — 'queued' then immediately sent via send.ts.
//   6. every AI-authored row is audited (actor='ai').
//
// IDEMPOTENCY: a (booking|customer, template) pair gets at most one comms row in
// the dedupe window, so the cron can run hourly/nightly across multiple Vercel
// instances without ever double-messaging. status:'failed' rows are NOT counted
// as "already touched" so a transient send failure can be retried next sweep.

import { pb } from '../db/pb.js';
import { getRestaurant, toPbDateFilter } from '../booking/queries.js';
import { writeAudit } from '../booking/audit.js';
import { send } from '../email/send.js';
import { draftMessage } from './draft.js';
import { getGuestFeedbackConfig } from '../feedback/config.js';
import { selectThankYou, selectWinBack, selectOccasion, selectReminder } from './select.js';
import {
	COMMS_CONFIG_KEY,
	COMMS_KINDS,
	DEFAULT_COMMS_CONFIG,
	KIND_BY_TEMPLATE,
	MARKETING_KINDS,
	TEMPLATE,
	type BookingWithCustomer,
	type CommsCandidate,
	type CommsConfig,
	type CommsKind
} from './types.js';
import type { BrandId, Customer, Message, Restaurant } from '../db/types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** How far back to pull bookings for selection. Wide enough that the longest
 *  lookback (win-back lapsed window, ~120d) sees the guest's recent visits, and
 *  forward enough to catch upcoming occasion/reminder bookings (~7d). */
const SELECT_LOOKBACK_DAYS = 200;
const SELECT_AHEAD_DAYS = 10;

/** Dedup window: a kind already touched within this many days is skipped. Keeps
 *  win-back / occasion from re-firing while still allowing a fresh touch later. */
const DEDUPE_DAYS = 90;

export interface CommsSweepResult {
	brand: string;
	considered: number;
	drafted: number;
	queuedSent: number;
	skipped: number;
	failed: number;
	byKind: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Resolve the per-kind comms config for a brand from geisha_settings, merged
 *  over DEFAULT_COMMS_CONFIG so a partial/missing setting is always complete. */
export async function getCommsConfig(brand: BrandId): Promise<CommsConfig> {
	const base: CommsConfig = structuredCloneConfig(DEFAULT_COMMS_CONFIG);
	try {
		const restaurant = await getRestaurant(brand);
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(
				`restaurant=${q(restaurant.id)} && key=${q(COMMS_CONFIG_KEY)}`
			)
			.catch(() => null);
		const stored = row?.value;
		if (stored && typeof stored === 'object') {
			for (const kind of COMMS_KINDS) {
				const v = (stored as Record<string, unknown>)[kind];
				if (v && typeof v === 'object') {
					const o = v as { enabled?: unknown; autoSend?: unknown };
					if (typeof o.enabled === 'boolean') base[kind].enabled = o.enabled;
					if (typeof o.autoSend === 'boolean') base[kind].autoSend = o.autoSend;
				}
			}
		}
	} catch {
		// PB unreachable / no restaurant — defaults stand (review-first, reminder off).
	}
	return base;
}

function structuredCloneConfig(cfg: CommsConfig): CommsConfig {
	return {
		reminder: { ...cfg.reminder },
		thank_you: { ...cfg.thank_you },
		win_back: { ...cfg.win_back },
		occasion: { ...cfg.occasion }
	};
}

// ---------------------------------------------------------------------------
// Selection (deterministic, via the pure selectors)
// ---------------------------------------------------------------------------

/** Fetch the booking window for a brand with the customer expanded. */
async function fetchBookings(restaurantId: string, now: Date): Promise<BookingWithCustomer[]> {
	const c = await pb();
	const from = toPbDateFilter(
		new Date(now.getTime() - SELECT_LOOKBACK_DAYS * 86400000).toISOString()
	);
	const to = toPbDateFilter(new Date(now.getTime() + SELECT_AHEAD_DAYS * 86400000).toISOString());
	return c.collection('geisha_bookings').getFullList<BookingWithCustomer>({
		filter: `restaurant=${q(restaurantId)} && starts_at>=${q(from)} && starts_at<=${q(to)}`,
		expand: 'customer',
		sort: '-starts_at'
	});
}

/** Run every ENABLED selector for the config and concatenate the candidates. */
export function selectCandidates(
	bookings: BookingWithCustomer[],
	config: CommsConfig,
	now: Date
): CommsCandidate[] {
	const out: CommsCandidate[] = [];
	if (config.reminder.enabled) out.push(...selectReminder(bookings, now));
	if (config.thank_you.enabled) out.push(...selectThankYou(bookings, now));
	if (config.win_back.enabled) out.push(...selectWinBack(bookings, now));
	if (config.occasion.enabled) out.push(...selectOccasion(bookings, now));
	return out;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** Build a fast lookup of "already has a non-failed comms row" for (key, template).
 *  The key is the booking id for booking-level kinds, else the customer id. */
async function loadTouched(restaurantId: string, now: Date): Promise<Set<string>> {
	const c = await pb();
	const since = toPbDateFilter(new Date(now.getTime() - DEDUPE_DAYS * 86400000).toISOString());
	// Only comms templates, recent, and NOT failed (failed may be retried).
	const templates = Object.values(TEMPLATE)
		.map((t) => `template=${q(t)}`)
		.join(' || ');
	const rows = await c
		.collection('geisha_messages')
		.getFullList<Message>({
			filter: `(${templates}) && status!=${q('failed')} && created>=${q(since)}`
		})
		.catch(() => [] as Message[]);
	void restaurantId; // messages aren't restaurant-scoped; templates+window suffice
	const touched = new Set<string>();
	for (const m of rows) {
		const key = m.booking || m.customer;
		if (key) touched.add(`${m.template}::${key}`);
	}
	return touched;
}

/** The idempotency key for a candidate (template + booking|customer). */
function touchKey(candidate: CommsCandidate): string {
	const template = TEMPLATE[candidate.kind];
	const id = candidate.booking?.id || candidate.customer.id;
	return `${template}::${id}`;
}

// ---------------------------------------------------------------------------
// Drafting + queueing one candidate
// ---------------------------------------------------------------------------

/** Lifetime visit stats for a customer from the already-fetched window (cheap;
 *  good enough to ground the draft without another per-candidate query). */
function historyFor(customerId: string, bookings: BookingWithCustomer[]) {
	let visitCount = 0;
	let lastVisitISO: string | undefined;
	for (const b of bookings) {
		if (b.customer !== customerId) continue;
		if (b.status === 'completed') {
			visitCount++;
			if (!lastVisitISO || b.starts_at > lastVisitISO) lastVisitISO = b.starts_at;
		}
	}
	return { visitCount, lastVisitISO };
}

/**
 * Draft + persist one candidate. Creates a geisha_messages row as 'draft' (or
 * 'queued'→send for an auto-send kind), audits it, and returns the row plus
 * whether it was actually sent. NEVER throws — a single bad candidate must not
 * abort the sweep.
 */
async function processCandidate(
	candidate: CommsCandidate,
	restaurant: Restaurant,
	bookings: BookingWithCustomer[],
	autoSend: boolean
): Promise<'drafted' | 'sent' | 'failed'> {
	try {
		const drafted = await draftMessage(
			candidate,
			restaurant,
			historyFor(candidate.customer.id, bookings)
		);
		const template = TEMPLATE[candidate.kind];
		const c = await pb();

		const base = {
			booking: candidate.booking?.id ?? '',
			customer: candidate.customer.id,
			channel: 'email' as const,
			template,
			subject: drafted.subject,
			body: drafted.html,
			scheduled_for: ''
		};

		if (!autoSend) {
			const row = await c
				.collection('geisha_messages')
				.create<Message>({ ...base, status: 'draft', sent_at: '' });
			await writeAudit('ai', `comms_draft:${candidate.kind}`, 'geisha_messages', row.id, null, {
				template,
				customer: candidate.customer.id,
				reason: candidate.reason
			});
			return 'drafted';
		}

		// Auto-send: create as queued, dispatch, then stamp the outcome.
		const row = await c
			.collection('geisha_messages')
			.create<Message>({ ...base, status: 'queued', sent_at: '' });
		const { sent } = await send({
			to: candidate.customer.email,
			subject: drafted.subject,
			html: drafted.html
		});
		await c.collection('geisha_messages').update(row.id, {
			status: sent ? 'sent' : 'failed',
			sent_at: sent ? new Date().toISOString() : ''
		});
		await writeAudit('ai', `comms_autosend:${candidate.kind}`, 'geisha_messages', row.id, null, {
			template,
			customer: candidate.customer.id,
			reason: candidate.reason,
			sent
		});
		return sent ? 'sent' : 'failed';
	} catch (err) {
		console.error('[comms] processCandidate failed (non-fatal):', err);
		return 'failed';
	}
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/** Run the comms engine for ONE brand. Idempotent + best-effort throughout. */
export async function runCommsSweep(
	brand: BrandId,
	now: Date = new Date()
): Promise<CommsSweepResult> {
	const result: CommsSweepResult = {
		brand,
		considered: 0,
		drafted: 0,
		queuedSent: 0,
		skipped: 0,
		failed: 0,
		byKind: {}
	};

	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		return result; // brand not provisioned — no-op
	}

	const config = await getCommsConfig(brand);
	// Nothing enabled → nothing to do.
	if (!COMMS_KINDS.some((k) => config[k].enabled)) return result;

	const [bookings, touched, feedbackConfig] = await Promise.all([
		fetchBookings(restaurant.id, now),
		loadTouched(restaurant.id, now),
		getGuestFeedbackConfig(brand)
	]);

	// Guests who booked online are already thanked by the morning-after feedback
	// email (feedback/rules.ts) while that is on — don't send them a second note.
	const candidates = selectCandidates(bookings, config, now).filter(
		(c) => !(c.kind === 'thank_you' && feedbackConfig.enabled && c.booking?.source === 'online')
	);
	result.considered = candidates.length;

	// De-dup within this sweep too (a customer could match win-back once only).
	const seenThisSweep = new Set<string>();

	for (const candidate of candidates) {
		const key = touchKey(candidate);
		if (touched.has(key) || seenThisSweep.has(key)) {
			result.skipped++;
			continue;
		}
		// GDPR: marketing kinds require consent.
		if (MARKETING_KINDS.has(candidate.kind) && !candidate.customer.marketing_consent) {
			result.skipped++;
			continue;
		}
		seenThisSweep.add(key);

		const outcome = await processCandidate(
			candidate,
			restaurant,
			bookings,
			config[candidate.kind].autoSend
		);
		result.byKind[candidate.kind] = (result.byKind[candidate.kind] ?? 0) + 1;
		if (outcome === 'drafted') result.drafted++;
		else if (outcome === 'sent') result.queuedSent++;
		else result.failed++;
	}

	return result;
}

/** Run the sweep for every brand (the cron entry point). */
export async function runCommsSweepAll(now: Date = new Date()): Promise<CommsSweepResult[]> {
	const brands: BrandId[] = ['asia', 'fusion'];
	const out: CommsSweepResult[] = [];
	for (const brand of brands) out.push(await runCommsSweep(brand, now));
	return out;
}

// ---------------------------------------------------------------------------
// Outbox CRUD (admin/comms UI)
// ---------------------------------------------------------------------------

export interface OutboxRow {
	id: string;
	kind: CommsKind | 'other';
	template: string;
	status: string;
	subject: string;
	body: string;
	customerName: string;
	customerEmail: string;
	customerId: string;
	bookingId: string;
	scheduledFor: string;
	sentAt: string;
	created: string;
}

interface MessageWithCustomer extends Message {
	expand?: { customer?: Customer };
}

/** List outbox rows for a brand. Defaults to the comms templates only; pass
 *  `status` to filter (e.g. 'draft'). Most recent first. */
export async function listOutbox(
	brand: BrandId,
	opts: { status?: string; limit?: number } = {}
): Promise<OutboxRow[]> {
	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		return [];
	}
	const c = await pb();
	const templates = Object.values(TEMPLATE)
		.map((t) => `template=${q(t)}`)
		.join(' || ');
	let filter = `(${templates})`;
	if (opts.status) filter += ` && status=${q(opts.status)}`;
	const rows = await c
		.collection('geisha_messages')
		.getFullList<MessageWithCustomer>({
			filter,
			expand: 'customer',
			sort: '-created'
		})
		.catch(() => [] as MessageWithCustomer[]);

	// messages aren't restaurant-scoped; filter to this brand via the customer's
	// home restaurant when present (a customer with no restaurant shows in both).
	return rows
		.filter((m) => {
			const cu = m.expand?.customer;
			return !cu?.restaurant || cu.restaurant === restaurant.id;
		})
		.slice(0, opts.limit ?? 200)
		.map(toOutboxRow);
}

function toOutboxRow(m: MessageWithCustomer): OutboxRow {
	const cu = m.expand?.customer;
	return {
		id: m.id,
		kind: KIND_BY_TEMPLATE[m.template] ?? 'other',
		template: m.template,
		status: m.status || '',
		subject: m.subject || '',
		body: m.body || '',
		customerName: cu?.name || '(unknown guest)',
		customerEmail: cu?.email || '',
		customerId: m.customer || '',
		bookingId: m.booking || '',
		scheduledFor: m.scheduled_for || '',
		sentAt: m.sent_at || '',
		created: m.created
	};
}

/** Count outbox rows by status for the page header badges. */
export async function outboxCounts(brand: BrandId): Promise<Record<string, number>> {
	const rows = await listOutbox(brand, { limit: 1000 });
	const counts: Record<string, number> = {};
	for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
	return counts;
}

/** Load a single comms message (for the edit/send actions). */
async function loadComms(id: string): Promise<MessageWithCustomer | null> {
	const c = await pb();
	return c
		.collection('geisha_messages')
		.getOne<MessageWithCustomer>(id, { expand: 'customer' })
		.catch(() => null);
}

/** Update a draft's subject/body (staff edit before approve/send). */
export async function editDraft(
	id: string,
	patch: { subject?: string; body?: string },
	staffId: string
): Promise<void> {
	const c = await pb();
	const before = await loadComms(id);
	if (!before) throw new Error('Message not found.');
	if (before.status !== 'draft' && before.status !== 'approved') {
		throw new Error('Only a draft or approved message can be edited.');
	}
	const data: Record<string, string> = {};
	if (typeof patch.subject === 'string') data.subject = patch.subject;
	if (typeof patch.body === 'string') data.body = patch.body;
	const after = await c.collection('geisha_messages').update<Message>(id, data);
	await writeAudit('staff', 'comms_edit', 'geisha_messages', id, before, after, staffId);
}

/** Mark a draft 'approved' (cleared to send on the next auto-send sweep / now). */
export async function approveDraft(id: string, staffId: string): Promise<void> {
	const c = await pb();
	const before = await loadComms(id);
	if (!before) throw new Error('Message not found.');
	if (before.status !== 'draft') throw new Error('Only a draft can be approved.');
	const after = await c.collection('geisha_messages').update<Message>(id, { status: 'approved' });
	await writeAudit('staff', 'comms_approve', 'geisha_messages', id, before, after, staffId);
}

/** Discard a draft/approved message (mark 'skipped' — kept for the audit trail
 *  and so idempotency still treats the guest as touched). */
export async function discardDraft(id: string, staffId: string): Promise<void> {
	const c = await pb();
	const before = await loadComms(id);
	if (!before) throw new Error('Message not found.');
	if (before.status === 'sent') throw new Error('A sent message cannot be discarded.');
	const after = await c.collection('geisha_messages').update<Message>(id, { status: 'skipped' });
	await writeAudit('staff', 'comms_discard', 'geisha_messages', id, before, after, staffId);
}

/** Send a draft/approved message NOW (staff-initiated). Dispatches via Resend and
 *  stamps the outcome. Returns { sent }. Audited on behalf of the staff member. */
export async function sendNow(id: string, staffId: string): Promise<{ sent: boolean }> {
	const c = await pb();
	const before = await loadComms(id);
	if (!before) throw new Error('Message not found.');
	if (before.status === 'sent') return { sent: true }; // idempotent
	if (before.status !== 'draft' && before.status !== 'approved') {
		throw new Error('Only a draft or approved message can be sent.');
	}
	const to = before.expand?.customer?.email;
	if (!to) {
		await c.collection('geisha_messages').update(id, { status: 'failed' });
		throw new Error('Guest has no email address on file.');
	}
	const { sent } = await send({ to, subject: before.subject || '', html: before.body || '' });
	const after = await c.collection('geisha_messages').update<Message>(id, {
		status: sent ? 'sent' : 'failed',
		sent_at: sent ? new Date().toISOString() : ''
	});
	await writeAudit(
		'staff',
		sent ? 'comms_send' : 'comms_send_failed',
		'geisha_messages',
		id,
		before,
		after,
		staffId
	);
	return { sent };
}

/** Save the per-kind comms config for a brand (settings, audited). */
export async function setCommsConfig(
	brand: BrandId,
	config: CommsConfig,
	staffId: string
): Promise<void> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const existing = await c
		.collection('geisha_settings')
		.getFirstListItem<{ id: string; value: unknown }>(
			`restaurant=${q(restaurant.id)} && key=${q(COMMS_CONFIG_KEY)}`
		)
		.catch(() => null);
	if (existing) {
		const before = { ...existing };
		const row = await c.collection('geisha_settings').update(existing.id, { value: config });
		await writeAudit(
			'staff',
			'update_setting',
			'geisha_settings',
			existing.id,
			before,
			row,
			staffId
		);
	} else {
		const row = await c
			.collection('geisha_settings')
			.create({ restaurant: restaurant.id, key: COMMS_CONFIG_KEY, value: config });
		await writeAudit('staff', 'update_setting', 'geisha_settings', row.id, null, row, staffId);
	}
}
