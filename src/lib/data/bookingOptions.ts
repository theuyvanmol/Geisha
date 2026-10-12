// Bookable OPTIONS — the "An option is required for this booking" step.
//
// WHAT THIS IS
// ------------
// ResDiary calls these "Promotions" and shows them as a mandatory step between
// picking a time and entering your details: a list of pink cards, each with a
// Select button ("Standard Booking", "x Bottomless Brunch x", …). Choosing one
// decides two things at once:
//
//   1. what the guest is booking (a normal table vs Restaurant Week vs brunch), and
//   2. the deposit / card policy that applies to it.
//
// We had the two halves in separate places and no step joining them: the
// marketing offers in $lib/data/offers.ts (title, blurb, price, menu link) and
// the deposit T&Cs in $lib/data/promotions.ts (the exact wording shown before a
// guest pays). This module is the bookable view of both — one list, per brand,
// each entry carrying the guest-facing copy AND the money rule.
//
// PRECEDENCE WITH THE DEPOSIT RULES ENGINE
// ----------------------------------------
// An option's `deposit` is an OVERRIDE, not the default. When it's absent (the
// normal case — "Standard Booking" has none) the booking falls through to the
// configurable rules engine in server/booking/policy.ts exactly as before, so the
// existing Fri/Sat-3–5 hold and 6+-deposit rules still apply untouched. Only an
// option that genuinely changes the policy (brunch: £10pp from everyone,
// regardless of party size) sets it.
//
// EDITING
// -------
// This file is the DEFAULT. A `booking_options` row in geisha_settings overrides
// it per brand without a deploy — see server/booking/options.ts, which normalises
// stored JSON into exactly this shape. Same pattern as set_menus.

import type { BrandId } from './brand';

export type BookingOptionDepositKind = 'deposit' | 'noshow_hold' | 'none';

/** The money rule an option imposes, overriding the deposit-rules engine. */
export type BookingOptionDeposit = {
	kind: BookingOptionDepositKind;
	/** Per person, in pence. Ignored (and treated as 'none') when 0. */
	perPersonPence: number;
	/** 'auto' = charged now (deposit); 'manual' = card held, charged only on a
	 *  no-show / late cancellation. Defaults per kind. */
	capture?: 'auto' | 'manual';
};

export type BookingOption = {
	id: string;
	/** Bold label on the card, e.g. "Bottomless Brunch". */
	title: string;
	/** One line under the title. */
	blurb?: string;
	/** Headline price shown on the card, e.g. "£20pp". Display only. */
	price?: string;
	/** Full T&C wording shown before the guest pays. Falls back to the linked
	 *  promotion's `message` when absent. */
	terms?: string;
	/**
	 * ResDiary "Colour": the ink the diary writes a booking's NAME in when it
	 * carries this option, so a brunch reads as a brunch across a board of
	 * otherwise identical blue bars. Absent = the normal bar ink.
	 *
	 * Colour, not a filled bar: the bar's own fill already answers a different
	 * question (arrived / seated / late), and painting over it would cost the
	 * floor that answer to gain this one. ResDiary does the same.
	 */
	colour?: string;

	// --- when this option is bookable -------------------------------------
	/** 0=Sun … 6=Sat. Empty/absent = every day. */
	days?: number[];
	/** Local time window 'HH:mm', inclusive start / exclusive end. */
	from?: string;
	to?: string;
	/** Seasonal window, ISO 'YYYY-MM-DD' inclusive. */
	dateFrom?: string;
	dateTo?: string;
	/** Party bounds. partyMax 0/absent = unbounded. */
	partyMin?: number;
	partyMax?: number;
	/** Minimum notice in hours (brunch needs 48). 0/absent = none. */
	noticeHours?: number;

	// --- what it costs / links to -----------------------------------------
	deposit?: BookingOptionDeposit;
	/** Matching id in $lib/data/offers.ts, if this option promotes one. */
	offerId?: string;
	/** Menu page a guest can open in a new tab to see what they're booking. */
	href?: string;
	/** Matching id in $lib/data/promotions.ts — supplies `terms` when unset and
	 *  is the label stamped onto booking.promotion for the diary. */
	promotionId?: string;
	/** The fallback that is ALWAYS offered and preselected. Exactly one per brand
	 *  should carry this; the resolver enforces it. */
	isDefault?: boolean;
};

/** Context an option is matched against — the slot the guest has just chosen. */
export type OptionContext = {
	/** 0=Sun … 6=Sat, in the restaurant's local time. */
	dow: number;
	/** Local 'YYYY-MM-DD'. */
	date: string;
	/** Local 'HH:mm'. */
	time: string;
	partySize: number;
	/** Hours between now and the booking. Infinity when unknown (skips notice). */
	hoursUntil: number;
};

/** 'HH:mm' → minutes since midnight. Returns null for anything unparseable. */
function minutes(hhmm: string | undefined): number | null {
	const m = hhmm?.trim().match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	const h = Number(m[1]);
	const mi = Number(m[2]);
	if (h > 23 || mi > 59) return null;
	return h * 60 + mi;
}

/**
 * Is this option bookable for the chosen slot?
 *
 * Pure and total — every clause is skipped when its field is absent, so an option
 * with no constraints is always available. The default option bypasses the whole
 * check: a guest must always have something to select, or the step becomes a dead
 * end and they can't book at all.
 */
export function optionAvailable(opt: BookingOption, ctx: OptionContext): boolean {
	if (opt.isDefault) return true;

	if (opt.days?.length && !opt.days.includes(ctx.dow)) return false;
	if (opt.dateFrom && ctx.date < opt.dateFrom) return false;
	if (opt.dateTo && ctx.date > opt.dateTo) return false;

	const start = minutes(opt.from);
	const end = minutes(opt.to);
	const at = minutes(ctx.time);
	if (at !== null) {
		if (start !== null && at < start) return false;
		if (end !== null && at >= end) return false;
	}

	if (opt.partyMin && ctx.partySize < opt.partyMin) return false;
	if (opt.partyMax && opt.partyMax > 0 && ctx.partySize > opt.partyMax) return false;

	if (opt.noticeHours && ctx.hoursUntil < opt.noticeHours) return false;

	return true;
}

/** The options bookable for a slot, default first. Never empty when a default
 *  exists in the list. */
export function availableOptions(
	options: BookingOption[],
	ctx: OptionContext
): BookingOption[] {
	const matched = options.filter((o) => optionAvailable(o, ctx));
	// Default first so it's the preselected card, mirroring ResDiary.
	return [...matched].sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)));
}

// --- the defaults ----------------------------------------------------------
//
// TWO OPTIONS, MIRRORING THE LIVE RESDIARY (owner, Aug 2026).
//
// An earlier version of this file listed five per brand — Restaurant Week,
// Sunday Roast, Daytime Special and so on — built from $lib/data/offers.ts. That
// was wrong, and wrong in a way that would have shown guests a menu the
// restaurant cannot honour at booking time. Those are MARKETING offers: things
// advertised on the What's On page and ordered at the table. They are not
// bookable options, and ResDiary does not offer them as such.
//
// What ResDiary actually offers a guest is two things:
//
//   • Standard Booking      — every day, always.
//   • x Bottomless Brunch x — Fri & Sat, 12:00–15:00, 48 hours' notice, £10pp.
//
// (Their third promotion, "Weekend Bookings", is the £5pp Fri/Sat card guarantee
// for parties of 3–5. It is POLICY, attached automatically to a qualifying
// booking — never a card the guest picks — so it is deliberately absent here and
// lives in the deposit-rules engine instead. See promotions.ts.)
//
// Deposits below are set ONLY where the option genuinely changes the policy.
// Standard Booking has none: it inherits the live deposit rules (Fri/Sat 3–5 →
// £5pp card guarantee; 6+ → £10pp deposit), which managers edit in
// /admin/settings/deposits. Duplicating them here would let the two drift.
//
// Both brands currently carry the same two, because both run the same promotions
// in their respective ResDiary diaries. If that stops being true, this is the
// file to split — or override per brand via the `booking_options` setting.

const STANDARD: BookingOption = {
	id: 'standard',
	title: 'Standard Booking',
	blurb: 'A table from our full à la carte menu.',
	promotionId: 'standard',
	isDefault: true
};

/**
 * Bottomless Brunch, per the live ResDiary promotion: Friday and Saturday only,
 * 12:00–15:00, minimum 48 hours' notice, £10 per head redeemable against the
 * bill. `partyMin: 2` because it is sold per table, not per cover.
 */
function brunch(brand: BrandId, price: string, blurb: string): BookingOption {
	return {
		id: 'brunch',
		title: 'Bottomless Brunch',
		blurb,
		price,
		days: [5, 6],
		from: '12:00',
		to: '15:00',
		partyMin: 2,
		noticeHours: 48,
		// The one real override: brunch takes £10pp from EVERY party, where the
		// standard rules would take nothing from a table of two.
		deposit: { kind: 'deposit', perPersonPence: 1000, capture: 'auto' },
		// Red, as it is in the ResDiary the floor has read for years. Deliberately a
		// dark red rather than the alert red the diary uses for a late table — those
		// mean "act now", this means "this table is drinking".
		colour: '#c0121b',
		promotionId: 'bottomless-brunch',
		offerId: 'brunch',
		href: `/${brand}/menus/bottomless-brunch`
	};
}

export const DEFAULT_BOOKING_OPTIONS: Record<BrandId, BookingOption[]> = {
	asia: [
		STANDARD,
		brunch('asia', '£40pp', '90 minutes of free-flowing drinks with three pan-Asian dishes each.')
	],
	fusion: [
		STANDARD,
		brunch('fusion', '£35pp', '90 minutes of free-flowing drinks with three dishes each.')
	]
};

/** The default catalogue for a brand (before any geisha_settings override). */
export function getBookingOptionDefaults(brand: BrandId): BookingOption[] {
	return DEFAULT_BOOKING_OPTIONS[brand];
}
