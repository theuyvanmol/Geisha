// mf-guest-comms — shared types for the autonomous personalised guest-comms
// engine. Kept dependency-free (no PB / no AI imports) so the pure recipient
// selector (select.ts) and its unit tests can import these without pulling in
// the server runtime.

import type { Booking, Customer } from '../db/types.js';

/**
 * The four kinds of "touch" the engine sends. Each maps 1:1 to a geisha_messages
 * `template` value so the outbox + idempotency key can group/dedupe by kind.
 *
 *   reminder      — pre-service "see you tomorrow" (the core no-show reducer)
 *   thank_you     — post-visit thank-you after a completed booking
 *   win_back      — re-engagement for a lapsed customer (no visit in N days)
 *   occasion      — birthday / anniversary / celebration acknowledgement
 *
 * NOTE: the existing transactional reminder cron (api/cron/reminder) owns
 * template 'reminder'. To avoid colliding on that idempotency key, the comms
 * engine's reminder uses template 'comms_reminder' (see TEMPLATE below) and is
 * OFF by default — the engine is opt-in per kind via settings, so the two never
 * double-send. The other three kinds are unique to this engine.
 */
export type CommsKind = 'reminder' | 'thank_you' | 'win_back' | 'occasion';

export const COMMS_KINDS: readonly CommsKind[] = [
	'reminder',
	'thank_you',
	'win_back',
	'occasion'
] as const;

/** geisha_messages `template` value written for each comms kind (idempotency key
 *  component). Prefixed so it never clashes with the transactional templates
 *  ('reminder' / 'confirmation') the booking flow already writes. */
export const TEMPLATE: Record<CommsKind, string> = {
	reminder: 'comms_reminder',
	thank_you: 'comms_thank_you',
	win_back: 'comms_win_back',
	occasion: 'comms_occasion'
};

/** Reverse lookup template → kind, for the outbox UI / engine reads. */
export const KIND_BY_TEMPLATE: Record<string, CommsKind> = Object.fromEntries(
	(Object.entries(TEMPLATE) as [CommsKind, string][]).map(([k, t]) => [t, k])
) as Record<string, CommsKind>;

/** Friendly label per kind for the outbox UI + audit copy. */
export const KIND_LABEL: Record<CommsKind, string> = {
	reminder: 'Reminder',
	thank_you: 'Thank-you',
	win_back: 'Win-back',
	occasion: 'Occasion'
};

/**
 * A booking with its customer expanded — the unit the selector works on. The
 * expand may be absent (the selector then skips it, since a touch needs an email
 * address from the customer record).
 */
export interface BookingWithCustomer extends Booking {
	expand?: { customer?: Customer };
}

/** A chosen recipient: which booking/customer, which kind, and WHY (the human-
 *  readable reason, surfaced in the outbox + fed to the drafter as context). */
export interface CommsCandidate {
	kind: CommsKind;
	booking?: BookingWithCustomer; // win-back is customer-level (no booking)
	customer: Customer;
	/** Plain-English reason this candidate was selected (audit + draft context). */
	reason: string;
	/** Occasion phrase when kind = 'occasion' (e.g. 'birthday', 'anniversary'). */
	occasion?: string;
}

/** Per-kind engine configuration resolved from settings (see engine.settings). */
export interface CommsKindConfig {
	/** Whether this kind is selected/queued at all. Default: thank_you + win_back +
	 *  occasion ON, reminder OFF (the transactional cron already reminds). */
	enabled: boolean;
	/** Whether an approved/ready draft is sent automatically, or held for review.
	 *  Default: false (review-first) for every kind. */
	autoSend: boolean;
}

export type CommsConfig = Record<CommsKind, CommsKindConfig>;

/** The settings key (per brand) holding the JSON CommsConfig. */
export const COMMS_CONFIG_KEY = 'comms_config';

/** Engine defaults: only the no-show-reducing reminder is off (the transactional
 *  cron owns reminders); everything else selects but holds for review. */
export const DEFAULT_COMMS_CONFIG: CommsConfig = {
	reminder: { enabled: false, autoSend: false },
	thank_you: { enabled: true, autoSend: false },
	win_back: { enabled: true, autoSend: false },
	occasion: { enabled: true, autoSend: false }
};

/** Marketing-type kinds that REQUIRE customer.marketing_consent (GDPR). The
 *  reminder + thank-you are service/transactional and don't need marketing
 *  consent; win-back + occasion are re-engagement marketing and do. */
export const MARKETING_KINDS: ReadonlySet<CommsKind> = new Set<CommsKind>(['win_back', 'occasion']);
