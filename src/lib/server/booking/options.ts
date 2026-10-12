// Server resolver for the bookable OPTIONS step (ResDiary "Promotions").
//
// Reads the per-brand catalogue — a `booking_options` row in geisha_settings when
// one exists, otherwise the defaults in $lib/data/bookingOptions — filters it to
// the slot the guest picked, and turns the chosen option into the two things the
// write path needs: a PaymentRequirement override and the promotion label stamped
// onto the booking.
//
// Same shape and the same failure posture as setMenus.ts: every read degrades to
// the defaults rather than throwing, because this sits on the public booking path
// and a settings hiccup must not cost a reservation.

import type { BrandId, Restaurant, Setting } from '../db/types.js';
import {
	availableOptions,
	getBookingOptionDefaults,
	optionAvailable,
	type BookingOption,
	type OptionContext
} from '../../data/bookingOptions.js';
import { getPromotion } from '../../data/promotions.js';
import type { PaymentRequirement } from './policy.js';

export const BOOKING_OPTIONS_KEY = 'booking_options';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** A number if it's a finite, non-negative one; else undefined. */
function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}

/** A trimmed non-empty string, else undefined. */
function str(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 'HH:mm' or undefined. */
function time(v: unknown): string | undefined {
	const s = str(v);
	return s && /^\d{1,2}:\d{2}$/.test(s) ? s : undefined;
}

/** ISO 'YYYY-MM-DD' or undefined. */
function isoDate(v: unknown): string | undefined {
	const s = str(v);
	return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

/** Coerce a stored deposit override, dropping anything that isn't usable. */
function depositOf(v: unknown): BookingOption['deposit'] {
	if (!v || typeof v !== 'object') return undefined;
	const r = v as Record<string, unknown>;
	const kind = str(r.kind);
	if (kind !== 'deposit' && kind !== 'noshow_hold' && kind !== 'none') return undefined;
	const perPersonPence = num(r.perPersonPence) ?? 0;
	const capture = str(r.capture);
	return {
		kind,
		perPersonPence,
		capture: capture === 'manual' || capture === 'auto' ? capture : undefined
	};
}

/**
 * Coerce an unknown geisha_settings value into a clean BookingOption[].
 * Exported for the unit tests and for any future admin editor — same contract as
 * normaliseSetMenus: an entry without an id AND a title is dropped rather than
 * half-rendered.
 */
export function normaliseBookingOptions(value: unknown): BookingOption[] {
	if (!Array.isArray(value)) return [];
	const out: BookingOption[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const id = str(r.id);
		const title = str(r.title);
		if (!id || !title) continue;
		const days = Array.isArray(r.days)
			? r.days.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
			: undefined;
		out.push({
			id,
			title,
			blurb: str(r.blurb),
			price: str(r.price),
			terms: str(r.terms),
			colour: str(r.colour),
			days: days?.length ? days : undefined,
			from: time(r.from),
			to: time(r.to),
			dateFrom: isoDate(r.dateFrom),
			dateTo: isoDate(r.dateTo),
			partyMin: num(r.partyMin),
			partyMax: num(r.partyMax),
			noticeHours: num(r.noticeHours),
			deposit: depositOf(r.deposit),
			offerId: str(r.offerId),
			href: str(r.href),
			promotionId: str(r.promotionId),
			isDefault: r.isDefault === true
		});
	}
	return out;
}

/**
 * The whole catalogue for a brand: the stored override when a non-empty one
 * exists, else the defaults. Never throws and never returns [] — an empty or
 * unreadable settings row falls back to the defaults, because a booking flow with
 * no selectable option is a dead end.
 */
export async function getBookingOptions(brand: BrandId): Promise<BookingOption[]> {
	const defaults = getBookingOptionDefaults(brand);
	let restaurant: Restaurant;
	try {
		const { getRestaurant } = await import('./queries.js');
		restaurant = await getRestaurant(brand);
	} catch {
		return defaults;
	}
	try {
		const { pb } = await import('../db/pb.js');
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurant.id)} && key=${q(BOOKING_OPTIONS_KEY)}`);
		const stored = normaliseBookingOptions(row.value);
		return stored.length ? ensureDefault(stored) : defaults;
	} catch {
		return defaults;
	}
}

/**
 * Guarantee exactly one always-available option. A stored catalogue that flags
 * none (or several) would otherwise be able to produce an empty step for some
 * slots — the first entry is promoted and the rest demoted.
 */
function ensureDefault(options: BookingOption[]): BookingOption[] {
	const firstDefault = options.findIndex((o) => o.isDefault);
	const keep = firstDefault === -1 ? 0 : firstDefault;
	return options.map((o, i) => ({ ...o, isDefault: i === keep }));
}

/** Local day-of-week 0..6 for an instant in a timezone. */
function localDow(at: Date, timezone: string): number {
	const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(at);
	return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? at.getDay();
}

/** Build the match context for a slot. `startsAt` is the booking instant. */
export function contextFor(
	startsAt: Date,
	timezone: string,
	partySize: number,
	now: Date = new Date()
): OptionContext {
	const date = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(startsAt);
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: timezone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(startsAt);
	return {
		dow: localDow(startsAt, timezone),
		date,
		time,
		partySize,
		hoursUntil: (startsAt.getTime() - now.getTime()) / 3_600_000
	};
}

/** What the widget renders on the options step, per option. */
export interface PublicBookingOption {
	id: string;
	title: string;
	blurb?: string;
	price?: string;
	/** Full T&Cs (option's own wording, else the linked promotion's). */
	terms?: string;
	href?: string;
	isDefault: boolean;
	/** Deposit this option will take, resolved for THIS party size — so the card
	 *  can say "£20 deposit" rather than "£10 per person". For an option that
	 *  inherits the standard rules it is what those rules take, when the caller
	 *  supplied them (see toPublicOption); 0 when nothing is taken. */
	depositPence: number;
	depositKind: 'deposit' | 'noshow_hold' | 'none';
}

/** The full T&C wording for an option: its own, else its promotion's. */
export function termsFor(option: BookingOption): string | undefined {
	if (option.terms) return option.terms;
	return getPromotion(option.promotionId)?.message || undefined;
}

/** What the deposit rules will take for a slot — see slotRequirement(). */
export type InheritedRequirement = Pick<PaymentRequirement, 'kind' | 'amountPence'>;

/**
 * Public projection of one option for a given party size.
 *
 * `inherited` is what the deposit rules will take for this slot. An option with NO
 * deposit of its own shows it — the same precedence createBooking applies
 * (requirementForOption → null → the rules decide). An option that declares its own
 * deposit, including one that explicitly waives it, keeps its own. Without this the
 * options step said nothing for an ordinary large table, and a party of 8 first saw
 * "£80" on the card screen, after typing their details.
 */
export function toPublicOption(
	option: BookingOption,
	partySize: number,
	inherited?: InheritedRequirement
): PublicBookingOption {
	const d = option.deposit;
	const own = d && d.perPersonPence > 0 ? d.kind : 'none';
	const fromRules = !d && inherited && inherited.kind !== 'none' && inherited.amountPence > 0;
	return {
		id: option.id,
		title: option.title,
		blurb: option.blurb,
		price: option.price,
		terms: termsFor(option),
		href: option.href,
		isDefault: Boolean(option.isDefault),
		depositPence: fromRules
			? inherited.amountPence
			: own === 'none'
				? 0
				: (d?.perPersonPence ?? 0) * partySize,
		depositKind: fromRules ? inherited.kind : own === 'none' ? 'none' : own
	};
}

/**
 * The options a guest may choose for this slot, ready to render. Default first.
 */
export async function listBookingOptions(
	brand: BrandId,
	startsAt: Date,
	timezone: string,
	partySize: number,
	now?: Date,
	inherited?: InheritedRequirement
): Promise<PublicBookingOption[]> {
	const catalogue = await getBookingOptions(brand);
	const ctx = contextFor(startsAt, timezone, partySize, now);
	return availableOptions(catalogue, ctx).map((o) => toPublicOption(o, partySize, inherited));
}

/**
 * Resolve a guest-submitted option id against the catalogue and the slot.
 *
 * Returns null for an empty id, an unknown id, or an option that isn't actually
 * available for this slot — all of which mean "treat this as a standard booking"
 * rather than an error. The id arrives from the browser and a guest can put
 * anything in it, so a mismatch must never be able to buy a cheaper deposit or a
 * booking outside an option's window; falling back to the standard rules is the
 * conservative outcome in both directions.
 */
export async function resolveBookingOption(
	brand: BrandId,
	optionId: string | undefined | null,
	startsAt: Date,
	timezone: string,
	partySize: number,
	now?: Date,
	opts: {
		/**
		 * Skip the "is this option running at that slot?" gate. STAFF ONLY.
		 *
		 * The window exists to stop a guest hand-editing an id to buy a Friday
		 * brunch on a Tuesday. It has no business refusing the restaurant: a host
		 * takes a brunch booking by phone inside the 48-hour notice, or for the
		 * private room on a Thursday, because the restaurant has decided to. The
		 * guest path never passes this, so the public rules are untouched.
		 */
		ignoreAvailability?: boolean;
	} = {}
): Promise<BookingOption | null> {
	const id = (optionId || '').trim();
	if (!id) return null;
	const catalogue = await getBookingOptions(brand);
	const option = catalogue.find((o) => o.id === id);
	if (!option) return null;
	if (opts.ignoreAvailability) return option;
	const ctx = contextFor(startsAt, timezone, partySize, now);
	return optionAvailable(option, ctx) ? option : null;
}

/**
 * The PaymentRequirement an option imposes, or null when it imposes none and the
 * deposit-rules engine should decide (the normal case).
 *
 * Mirrors the wording requirementFromRule() produces so the guest sees one voice
 * across both paths, and carries the option's own terms through as `reason` when
 * it has them — that string is what gets shown above the card form and stored
 * with the authorisation, so it has to be the exact wording they agreed to.
 */
export function requirementForOption(
	option: BookingOption,
	partySize: number
): PaymentRequirement | null {
	const d = option.deposit;
	if (!d) return null;

	const terms = termsFor(option);
	const label = option.title;

	if (d.kind === 'none' || d.perPersonPence <= 0) {
		return {
			kind: 'none',
			perPersonPence: 0,
			amountPence: 0,
			reason: '',
			promotion: option.promotionId || option.id,
			promotionName: label,
			promotionTerms: terms
		};
	}

	const perPersonPence = d.perPersonPence;
	const pounds = (perPersonPence / 100).toFixed(2);
	const common = {
		perPersonPence,
		amountPence: perPersonPence * partySize,
		promotion: option.promotionId || option.id,
		promotionName: label,
		promotionTerms: terms
	};

	if (d.kind === 'deposit') {
		return {
			...common,
			kind: 'deposit',
			capture: d.capture || 'auto',
			reason:
				terms ||
				`${label} requires a deposit of £${pounds} per person. This is deducted from your final bill.`
		};
	}
	return {
		...common,
		kind: 'noshow_hold',
		capture: d.capture || 'manual',
		reason:
			terms ||
			`${label} requires card details to confirm. A fee of £${pounds} per person applies only in case of a no-show or late cancellation.`
	};
}
