// Booking mutations used by admin (and later the AI layer): cancel, seat, move,
// clear, no-show. Each records an audit entry. Floor-state writes power the live
// floor plan ("who's sat where"). Payment capture/reverse on cancel/no-show is
// wired in P4 — for now these handle the booking + floor_state side.

import { pb } from '../db/pb.js';
import type { Booking, FloorState } from '../db/types.js';
import { writeAudit } from './audit.js';
import { deferWork } from '../util/defer.js';
import type { AuditActor } from '../db/types.js';
import { settleNoShowMoney, releaseHold, refundDeposit } from './payments.js';
import { isLateCancellation, depositRefundable, LATE_CANCELLATION_LABEL } from './policy.js';
import { sendCancellation } from '../email/confirmations.js';
import { recomputeCustomerCounters, setCustomerBlocked } from './crm.js';
import type { Customer, Restaurant } from '../db/types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

async function getBooking(id: string): Promise<Booking> {
	const c = await pb();
	return c.collection('geisha_bookings').getOne<Booking>(id);
}

/**
 * Re-point a booking's live (uncleared) floor_state rows onto `newTableIds`.
 *
 * The diary amend/swap/batch paths change `booking.tables` but do NOT touch
 * geisha_floor_state — so dragging or swapping a SEATED party left the floor plan
 * and turn board showing them on the OLD table (floor state keys "who's sat where"
 * by floor_state.table). This reconciles the uncleared rows to the new tables:
 * keep at most one active row per retained table, create rows for newly-added
 * tables, drop rows for vacated tables. A no-op for a booking with no active
 * floor_state (an upcoming reservation that was never seated). Best-effort: the
 * caller runs it via deferWork off the response, and it NEVER throws — a floor_state
 * hiccup must never fail an already-committed booking move. `nowISO` seats any
 * freshly-created row.
 *
 * RACE GUARD: this runs DEFERRED (after the response, off the lock), so between the
 * amend committing and this executing, another device could clear / reset / no-show
 * the SAME booking (each of those already reconciles floor_state themselves — set
 * cleared_at, delete rows, or drop the seating). If we blindly recreated a row for a
 * newly-added table we'd resurrect a phantom seated party on a cancelled booking. So we
 * RE-READ the booking's current status first and bail unless it's still 'seated' (live)
 * or 'completed' (a finished sitting being corrected) — the authoritative check that
 * this reconciliation is still wanted.
 */
export async function syncFloorStateTables(
	bookingId: string,
	newTableIds: string[],
	nowISO: string,
	/**
	 * RE-ANCHOR the sitting to this instant (ISO) as well as re-pointing its tables.
	 *
	 * Pass the booking's NEW `starts_at` whenever a staff diary edit CHANGED the start of
	 * an already-seated (or finished) booking. The diary draws a seated bar from its real
	 * seat time, not its booked time (the ResDiary late-arrival trim in getDiaryTimeline),
	 * so without this the seat stamp stays at the moment the host pressed "seat" and the
	 * bar snaps straight back on the next refresh — the owner's "I move a booking earlier
	 * and it reverts", and its uglier form: a party seated at 19:00 whose bar is dragged to
	 * 12:00 has a seat time outside the booked window entirely, which used to render as a
	 * 1-minute sliver. Dragging the bar IS the host stating when this party sat.
	 *
	 * Omit for a table-only change (a plain re-table or swap at the same time): the seat
	 * stamp is then real history and the late-arrival trim must keep working.
	 */
	reseatAtISO?: string
): Promise<void> {
	try {
		const c = await pb();
		// Re-read status NOW (not the stale snapshot the caller passed) — if the booking
		// was cleared/reset/no-showed/cancelled during the defer window, skip entirely so
		// we can't recreate an active row for a party that's no longer seated.
		const fresh = await c
			.collection('geisha_bookings')
			.getOne<Booking>(bookingId)
			.catch(() => null);
		// SEATED (live party) and COMPLETED (a finished sitting the host is correcting
		// from the diary — the bar stays draggable) both own floor_state that must follow
		// the move. Anything else (upcoming / cancelled / no-show) has nothing to move.
		if (!fresh || (fresh.status !== 'seated' && fresh.status !== 'completed')) return;
		const finished = fresh.status === 'completed';
		const rows = await c
			.collection('geisha_floor_state')
			.getFullList<FloorState>({ filter: `booking=${q(bookingId)}` });
		// For a live party the rows that matter are the UNCLEARED ones; for a finished
		// sitting they're all cleared, so take them as they are. An upcoming booking has
		// none either way, so there's nothing to move.
		const active = finished ? rows : rows.filter((r) => !r.cleared_at);
		if (active.length === 0) return;
		const want = new Set(newTableIds.filter((t) => t && t !== '__unassigned__'));
		const kept = new Set<string>();
		const keptRowIds = new Set<string>(); // the rows that SURVIVED, for the re-stamp below
		// Drop rows on tables the booking no longer holds; note which it keeps.
		for (const row of active) {
			if (want.has(row.table) && !kept.has(row.table)) {
				kept.add(row.table); // first row for a retained table stays
				keptRowIds.add(row.id);
			} else {
				await c.collection('geisha_floor_state').delete(row.id);
			}
		}
		// Create a row for each newly-added table, carrying the sitting's real timestamps
		// (earliest seating, and — for a finished sitting — its latest clear) so the turn
		// board keeps the true sit/leave times on the corrected table.
		const clearedAt = finished
			? active
					.map((r) => r.cleared_at)
					.filter(Boolean)
					.sort()
					.slice(-1)[0] || nowISO
			: '';
		const seatedSoFar =
			active
				.map((r) => r.seated_at)
				.filter(Boolean)
				.sort()[0] || nowISO;
		// A re-time re-anchors the sitting (see `reseatAtISO`). Refuse one that would land
		// AT OR AFTER a finished sitting's clear time — a negative-length sitting would
		// poison the turn-time medians (turns.ts takes the median of cleared − seated).
		const reseat = reseatAtISO && !(clearedAt && reseatAtISO >= clearedAt) ? reseatAtISO : '';
		const seatedAt = reseat || seatedSoFar;
		if (reseat) {
			// Re-stamp the rows we kept, so every table of the sitting reads the new time.
			for (const row of active) {
				if (!keptRowIds.has(row.id) || row.seated_at === reseat) continue;
				await c
					.collection('geisha_floor_state')
					.update(row.id, { seated_at: reseat })
					.catch(() => {});
			}
		}
		for (const tableId of want) {
			if (!kept.has(tableId)) {
				await c.collection('geisha_floor_state').create({
					booking: bookingId,
					table: tableId,
					seated_at: seatedAt,
					cleared_at: clearedAt
				});
			}
		}
	} catch (e) {
		console.error('[floor-state] sync after table change failed:', e);
	}
}

/**
 * A cancellation reason (ResDiary "Cancellation Type"). `blockCustomer` /
 * `appearInNoShowReport` mirror ResDiary's per-reason action flags; here they're
 * carried on the built-in reason list (see CANCELLATION_REASONS) rather than an
 * admin-editable settings collection.
 */
export interface CancelOptions {
	/** Reason code (see CANCELLATION_REASONS). Recorded on the audit trail. */
	reason?: string;
	/** Send the guest a cancellation email. Default true (ResDiary's default). */
	notify?: boolean;
	/**
	 * The geisha_staff id of the person who did this, recorded in the audit row's
	 * on_behalf_of so the booking history can name them ('Georgia Fox') instead of
	 * an anonymous 'staff'. Optional: system/AI callers legitimately have none.
	 */
	staffId?: string;
}

/**
 * The cancellation reasons staff may pick — mirroring the owner's ResDiary
 * "Cancellation Reasons" settings screen, in its order and wording.
 *
 * NO REASON CHARGES A CARD, and that is faithful to ResDiary: its reason table
 * has columns for Block Customer and Appear In No Show Report and NOTHING for
 * money. Taking a fee is a separate manual act (payments.chargeNoShowManual);
 * the two "Card Manually Charged" reasons below are how ResDiary RECORDS that a
 * human did it, so the cancellation report agrees with the money. Picking one
 * does not itself charge anything.
 *
 * A `noShow` reason isn't a plain cancel: the host routes it to
 * {@link markNoShow} so the booking lands in the no_show status and shows on the
 * no-show report. `blockCustomer` additionally blocks the guest from booking
 * ONLINE again (see crm.setCustomerBlocked). `online` marks the reason ResDiary
 * shows to guests — ours is stamped by the self-service cancel path.
 */
export const CANCELLATION_REASONS: {
	code: string;
	label: string;
	/** Also flag as a no-show in the cancellation report. */
	noShow?: boolean;
	/** Block the guest from booking online (adds the CRM `blocked` tag). */
	blockCustomer?: boolean;
	/** ResDiary's "Display Online" — the reason used when a guest self-cancels. */
	online?: boolean;
	/** Retired code kept so historic audit rows still resolve a label. */
	legacy?: boolean;
}[] = [
	{ code: 'illness', label: 'Illness' },
	{ code: 'competitor', label: 'One of party wished to go to competitor' },
	{ code: 'change_of_plans', label: 'Change of plans' },
	{ code: 'call_off', label: 'Call off from within party or group' },
	{ code: 'postponed', label: 'Postponed to a future date or time' },
	{ code: 'bad_experience', label: 'Bad Experience' },
	{ code: 'no_show_block', label: 'No Show and block user', noShow: true, blockCustomer: true },
	{ code: 'operator_error', label: 'Operator Error' },
	{ code: 'no_show', label: 'No Show and do not block user', noShow: true },
	{ code: 'online_cancellation', label: 'Online Cancellation', online: true },
	{ code: 'covid', label: 'Covid 19' },
	{ code: 'bad_weather', label: 'Bad Weather' },
	{ code: 'late_cancel_charged', label: 'Late cancellation - Card Manually Charged' },
	{ code: 'no_show_charged', label: 'No show - Card Manually Charged', noShow: true },
	// Retired: every cancellation before the ResDiary list landed carries this
	// code. Hidden from the picker (see visibleCancellationReasons) but kept here
	// so the cancellation report still renders a label instead of a bare code.
	{ code: 'guest_request', label: 'Guest cancelled', legacy: true }
];

/** The reasons a picker should offer — the live list, minus retired codes. */
export const visibleCancellationReasons = () => CANCELLATION_REASONS.filter((r) => !r.legacy);

/**
 * The reason a picker should start on. ResDiary's nearest equivalent to our old
 * "Guest cancelled" default, and deliberately NOT one of the no-show or
 * card-charged rows — a mis-submitted dialog must never land on one of those.
 */
export const DEFAULT_CANCELLATION_REASON = 'change_of_plans';

/** Is this reason code one of the no-show reasons? */
export const isNoShowReason = (code?: string) =>
	CANCELLATION_REASONS.find((r) => r.code === code)?.noShow ?? false;

/** Does this reason code also block the guest from booking online? */
export const reasonBlocksCustomer = (code?: string) =>
	CANCELLATION_REASONS.find((r) => r.code === code)?.blockCustomer ?? false;

const reasonLabel = (code?: string) =>
	CANCELLATION_REASONS.find((r) => r.code === code)?.label ?? (code || '');

/**
 * Cancel a booking. NEVER CHARGES A CARD — see settleNoShowMoney.
 *
 * An in-time cancellation (§6) releases any authorisation hold and refunds a
 * captured deposit. A LATE one keeps an already-paid deposit — money the guest
 * handed over under the policy they agreed to — and leaves a card on file
 * untouched for a manager to charge deliberately, or not.
 *
 * `opts` carries the ResDiary-style cancellation options: a `reason` (recorded on
 * the audit trail for the cancellation report) and a `notify` toggle for whether
 * the guest gets the cancellation email.
 */
export async function cancelBooking(
	id: string,
	actor: AuditActor = 'staff',
	opts: CancelOptions = {}
): Promise<Booking> {
	const { reason, notify = true } = opts;
	const before = await getBooking(id);
	const now = new Date();
	const startsAt = new Date(before.starts_at);
	const late = isLateCancellation(startsAt, now);
	const c = await pb();
	const after = await c.collection('geisha_bookings').update<Booking>(id, { status: 'cancelled' });
	// The booking is now cancelled. Everything below is a best-effort side-effect the
	// caller doesn't read — the payment capture/refund (a LIVE Stripe round-trip that can
	// throw), the cancellation email, the audit row, and the CRM counter recompute.
	// PREVIOUSLY these were awaited inline AFTER the status write: a provider throw made the
	// action report 500 (staff retry → double email) while the booking WAS cancelled,
	// and skipped the audit entirely. Now they run via deferWork so the cancel returns
	// as soon as the status flips, and each sub-step is independently guarded so one
	// failure (Stripe down) can never suppress the audit or the counter update.
	//
	// Record the reason + notify choice on the audit trail (the cancellation-report
	// surface) without a schema migration: fold a `_cancellation` meta block into the
	// audited `after` snapshot. `reasonNoShow` marks reasons that count as no-shows.
	const reasonMeta = {
		reason: reason ?? '',
		reasonLabel: reasonLabel(reason),
		reasonNoShow: CANCELLATION_REASONS.find((r) => r.code === reason)?.noShow ?? false,
		notified: notify
	};
	deferWork(async () => {
		// §6, as ResDiary does it: A CANCELLATION NEVER CHARGES A CARD.
		//
		// This branch used to call chargeNoShow(), so any cancel inside the late
		// window billed the guest's filed card off the clock alone — including the
		// commonest correction on the floor, a booking taken against the wrong brand
		// and re-made on the other. Staff had no way to say "cancel it but don't
		// charge". Now the late branch only SETTLES (reports what an already-paid
		// deposit does); taking a fee is a deliberate manager action on the booking's
		// payment panel. An in-time cancel is unchanged: release any hold AND refund a
		// captured deposit (depositRefundable === !late). Each call is a no-op for the
		// payment kinds it doesn't apply to, so both run safely. Guarded so a provider
		// failure can't stop the audit / email / counter below.
		// What the ONE cancellation email should say about money. Built as the
		// payment work happens, so it states what actually occurred rather than
		// what policy predicted — a refund that failed at the provider must not
		// produce an email promising one.
		let moneyNote = '';
		try {
			if (late) {
				const outcome = await settleNoShowMoney(id);
				// A forfeited deposit is the one case where nothing else tells the guest:
				// no money moves at the provider, so nothing sends an email of its own.
				// Cancelling inside the window used to produce a bare "your booking is
				// cancelled" while quietly keeping £60 — the guest's first hint was their
				// statement. (A card on file reports 'none' here: it is left untouched,
				// so there is nothing to tell the guest about.)
				if (outcome.kind === 'deposit_forfeited' && outcome.amountPence > 0) {
					moneyNote =
						`This was a late cancellation (less than ${LATE_CANCELLATION_LABEL} before your booking), ` +
						`so the £${(outcome.amountPence / 100).toFixed(2)} deposit you paid is not refunded. ` +
						`If you think this is a mistake, please give us a ring and we'll take a look.`;
				}
			} else {
				await releaseHold(id);
				if (depositRefundable(now, startsAt)) {
					// notify:false — the refund line goes INTO the cancellation email
					// below instead of arriving as a second message a second later.
					const refunded = await refundDeposit(
						id,
						'In-time cancellation — deposit refunded (§6).',
						{ notify: false }
					);
					if (refunded > 0) {
						moneyNote = `We've refunded £${(refunded / 100).toFixed(2)} to the card you paid with. Refunds usually reach your account within 5–10 working days, depending on your bank.`;
					}
				}
			}
		} catch (e) {
			console.error('[cancel] payment side-effect failed:', e);
		}
		// best-effort cancellation email — skipped when the host chose "don't notify".
		if (notify) {
			try {
				const customer = await c.collection('geisha_customers').getOne<Customer>(after.customer);
				const restaurant = await c
					.collection('geisha_restaurants')
					.getOne<Restaurant>(after.restaurant);
				await sendCancellation(after, customer, restaurant, moneyNote || undefined);
			} catch (e) {
				console.error('[cancel] email failed:', e);
			}
		}
		await writeAudit(
			actor,
			late ? 'cancel_late' : 'cancel_booking',
			'geisha_bookings',
			id,
			before,
			{ ...after, _cancellation: reasonMeta },
			opts.staffId
		);
		// WP-CRM-2: keep the guest's denormalised cancel/no-show counters live.
		await recomputeCustomerCounters(after.customer).catch((e) =>
			console.error('[cancel] counter recompute failed:', e)
		);
	}, 'cancel side-effects');
	return after;
}

/**
 * Put a cancelled / no-show booking BACK on the diary (ResDiary's Cancellation
 * List "restore"). The commonest reason a host wants this is the commonest kind
 * of mistake: the wrong row was cancelled, or the guest rang back.
 *
 * The booking keeps its time, party and diner — only the status is undone. Its
 * TABLES are the caller's call: the slot may well have been given away while the
 * booking was dead, so the diary action re-checks and passes either the original
 * tables (still free) or `[]` (reinstate UNALLOCATED, landing in the diary's
 * Unassigned row) rather than silently stacking two parties on one table.
 *
 * Deliberately NOT a payment operation: a forfeited deposit or captured no-show
 * fee stays as it was, because reversing money is a decision with its own paper
 * trail (the deposits report), not a side-effect of undoing a click.
 */
export async function reinstateBooking(
	id: string,
	actor: AuditActor = 'staff',
	opts: { tableIds?: string[]; staffId?: string } = {}
): Promise<Booking> {
	const before = await getBooking(id);
	if (before.status !== 'cancelled' && before.status !== 'no_show') return before;
	const c = await pb();
	const after = await c.collection('geisha_bookings').update<Booking>(id, {
		status: 'confirmed',
		floor_status: '',
		...(opts.tableIds ? { tables: opts.tableIds } : {})
	});
	deferWork(async () => {
		await writeAudit(
			actor,
			'reinstate_booking',
			'geisha_bookings',
			id,
			before,
			after,
			opts.staffId
		);
		// The guest's cancel / no-show counters include this booking — recompute.
		await recomputeCustomerCounters(after.customer).catch((e) =>
			console.error('[reinstate] counter recompute failed:', e)
		);
	}, 'reinstate side-effects');
	return after;
}

/**
 * Expire an abandoned pre-start unpaid hold (§S1-4). A `pending_payment` booking
 * whose card step was never completed and whose service hasn't started yet is
 * cancelled so its table is freed BEFORE service, and any authorisation hold is
 * reversed. Unlike {@link cancelBooking} this sends NO email (the guest never
 * actually confirmed) and uses `releaseHold` (no fee — they never committed).
 *
 * TOCTOU guard: the booking is re-read here and the expiry aborts (returning the
 * current row unchanged) if it is no longer `pending_payment` — e.g. the Stripe
 * webhook confirmed it the instant before the sweep ran.
 */
export async function expireUnpaidHold(id: string, actor: AuditActor = 'system'): Promise<Booking> {
	const before = await getBooking(id);
	// Re-read guard: only an still-pending hold may be expired. If the webhook has
	// since confirmed/advanced it (or another sweep already handled it), do nothing.
	if (before.status !== 'pending_payment') return before;

	const c = await pb();
	const after = await c.collection('geisha_bookings').update<Booking>(id, { status: 'cancelled' });
	// Never-confirmed: release/void the hold (no fee), never email.
	await releaseHold(id);
	await writeAudit(actor, 'expire_unpaid', 'geisha_bookings', id, before, after);
	return after;
}

/** Options for {@link markNoShow}. */
export interface NoShowOptions {
	/**
	 * Also block the guest from booking ONLINE again (the "No show - Block user"
	 * cancellation reason). Staff can still take them by phone / as a walk-in, and
	 * a manager can lift it from the guest profile.
	 */
	blockCustomer?: boolean;
	/**
	 * Which no-show reason was picked (see CANCELLATION_REASONS). Recorded on the
	 * audit trail exactly as a cancellation's is, so the report can tell "No Show
	 * and block user" from "No show - Card Manually Charged" — the latter being how
	 * ResDiary records that a manager took the fee by hand afterwards.
	 */
	reason?: string;
	/**
	 * The geisha_staff id of the person who did this, recorded in the audit row's
	 * on_behalf_of so the booking history can name them ('Georgia Fox') instead of
	 * an anonymous 'staff'. Optional: system/AI callers legitimately have none.
	 */
	staffId?: string;
}

/**
 * Mark a booking as a no-show.
 *
 * DOES NOT TOUCH THE CARD — see settleNoShowMoney. The booking lands in
 * `no_show` and on the no-show report; a filed card is left ON FILE for a
 * manager to charge deliberately (payments.chargeNoShowManual), and an
 * already-captured deposit simply stays captured, which needs no call at all.
 * This mirrors ResDiary, whose "No show - Card Manually Charged" reason exists
 * precisely because marking the no-show and taking the fee are two acts.
 */
export async function markNoShow(
	id: string,
	actor: AuditActor = 'staff',
	opts: NoShowOptions = {}
): Promise<Booking> {
	const before = await getBooking(id);
	const c = await pb();
	const after = await c
		.collection('geisha_bookings')
		.update<Booking>(id, { status: 'no_show', floor_status: '' });
	// The no-show status is written. The audit and CRM counter are best-effort
	// side-effects — defer them off the response and guard each so one failure can't
	// suppress the other, mirroring cancelBooking. There is deliberately NO payment
	// call here any more: a filed card stays on file for a manager to charge, and a
	// captured deposit staying captured requires no action.
	deferWork(async () => {
		// "No show - Block user": tag the guest as blocked so the online widget refuses
		// them. Guarded — a CRM failure must never make the no-show itself look failed.
		if (opts.blockCustomer) {
			await setCustomerBlocked(after.customer, true, actor).catch((e) =>
				console.error('[no-show] block customer failed:', e)
			);
		}
		// Same `_cancellation` meta block a cancel writes, so the cancellation report
		// reads one shape whichever action produced the row.
		await writeAudit(
			actor,
			'no_show',
			'geisha_bookings',
			id,
			before,
			{
				...after,
				_cancellation: {
					reason: opts.reason ?? '',
					reasonLabel: reasonLabel(opts.reason),
					reasonNoShow: true,
					notified: false
				}
			},
			opts.staffId
		);
		await recomputeCustomerCounters(after.customer).catch((e) =>
			console.error('[no-show] counter recompute failed:', e)
		);
	}, 'no-show side-effects');
	return after;
}

/**
 * Seat a booking at its table(s): set status=seated and create/refresh
 * floor_state rows with seated_at = now.
 */
export async function seatBooking(
	id: string,
	nowISO: string,
	actor: AuditActor = 'staff',
	/**
	 * Which of the booking's tables to mark seated. Omit to seat ALL of them (the
	 * normal "fully seated"). Pass a subset to seat only some — a multi-table booking
	 * with some-but-not-all tables seated derives as "partially seated" in the diary
	 * (ResDiary's left-menu "Partially Seated").
	 */
	onlyTables?: string[],
	/** geisha_staff id of the host who seated them — named in the booking history. */
	staffId?: string
): Promise<Booking> {
	const before = await getBooking(id);
	const c = await pb();
	// A "Partially Seated" call arrives with an explicit table subset — the diary/floor
	// `partialSeat` action is the ONLY caller that passes onlyTables (every full-seat
	// caller omits it). Stamp the booking with the host-set 'partially_seated' marker so
	// the diary derives partial even for a SINGLE-table booking, which has no
	// seatedCount<tableCount signal of its own. A full seat (no subset) clears floor_status
	// back to '' → 'arrived'. floor_status is a plain text field, so the extra value needs
	// no migration. (A full seat also clears any pre-seating waiting-bar/table-ready hold.)
	const partial = !!(onlyTables && onlyTables.length);
	// Undoing a finish puts the sitting back — see endsAtBeforeFinish.
	const restoreEnds = await endsAtBeforeFinish(c, id, before);
	const after = await c.collection('geisha_bookings').update<Booking>(id, {
		status: 'seated',
		floor_status: partial ? 'partially_seated' : '',
		...(restoreEnds ? { ends_at: restoreEnds } : {})
	});

	const allTables = after.tables ?? [];
	const seatTables = partial ? allTables.filter((t) => onlyTables!.includes(t)) : allTables;
	const seatSet = new Set(seatTables);
	for (const tableId of seatTables) {
		const existing = await c
			.collection('geisha_floor_state')
			.getFirstListItem<FloorState>(`booking=${q(id)} && table=${q(tableId)}`)
			.catch(() => null);
		if (existing) {
			await c
				.collection('geisha_floor_state')
				.update(existing.id, { seated_at: nowISO, cleared_at: '' });
		} else {
			await c
				.collection('geisha_floor_state')
				.create({ booking: id, table: tableId, seated_at: nowISO, cleared_at: '' });
		}
	}
	// PARTIAL seat: drop any floor_state rows for tables NOT in the seated subset, so a
	// booking that was previously fully seated correctly reads back as partial (and the
	// live floor frees the un-seated tiles). A full seat (no subset) keeps everything.
	if (partial) {
		const rows = await c
			.collection('geisha_floor_state')
			.getFullList<FloorState>({ filter: `booking=${q(id)}` });
		for (const row of rows) {
			if (!seatSet.has(row.table)) await c.collection('geisha_floor_state').delete(row.id);
		}
	}
	// Guest attended → release any no-show authorisation hold; then audit. Both are
	// best-effort side-effects the caller doesn't read, so defer them off the response
	// (releaseHold is a payment read+write that a walk-in with no deposit doesn't need
	// to wait on). The seating itself (status + floor_state) is already written above.
	deferWork(async () => {
		await releaseHold(id);
		await writeAudit(actor, 'seat_booking', 'geisha_bookings', id, before, after, staffId);
	}, 'seat side-effects');
	return after;
}

/**
 * Move a (seated or upcoming) booking to a different set of tables.
 *
 * Does NOT itself re-validate fit / free / joinable — the caller (the live-floor
 * `move`/`seatOn` actions, the AI tool) is responsible for that. Here we just
 * re-point booking.tables and, for a seated booking, rebuild its floor_state.
 * `onBehalfOf` (F3) records the real staff id when actor is 'ai'/'system'.
 */
export async function moveBooking(
	id: string,
	newTableIds: string[],
	nowISO: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Booking> {
	const before = await getBooking(id);
	const c = await pb();

	const after = await c.collection('geisha_bookings').update<Booking>(id, { tables: newTableIds });

	// Rebuild floor_state if currently seated. Order create-before-delete so a
	// failure never leaves a seated party with NO floor_state row (WP-LIVE-1 risk).
	if (after.status === 'seated') {
		for (const tableId of newTableIds) {
			await c
				.collection('geisha_floor_state')
				.create({ booking: id, table: tableId, seated_at: nowISO, cleared_at: '' });
		}
	}

	// Remove the booking's PRIOR floor_state rows (those not on a new table) so the
	// vacated tiles free up. Re-fetched after the recreate so freshly-created rows
	// for retained tables aren't deleted.
	const keep = new Set(newTableIds);
	const rows = await c
		.collection('geisha_floor_state')
		.getFullList<FloorState>({ filter: `booking=${q(id)}` });
	for (const row of rows) {
		// keep at most one active row per retained table; drop everything else
		if (keep.has(row.table) && !row.cleared_at) {
			keep.delete(row.table); // first active row for this table stays
			continue;
		}
		await c.collection('geisha_floor_state').delete(row.id);
	}

	await writeAudit(actor, 'move_booking', 'geisha_bookings', id, before, after, onBehalfOf);
	return after;
}

/**
 * Confirm a booking (ResDiary "Confirm your customer's booking"): set the
 * `confirmed` flag and bump confirm_attempts, so the diary's Confirmation colour
 * scheme reads it as confirmed. Best-effort on the column (silently ignored
 * pre-migration). Shared by the diary `?/confirm` action and the AI tool.
 */
export async function confirmBooking(
	id: string,
	actor: AuditActor = 'staff',
	/** geisha_staff id of the host who confirmed it — named in the booking history. */
	staffId?: string
): Promise<Booking> {
	const c = await pb();
	const before = await getBooking(id);
	const after = await c.collection('geisha_bookings').update<Booking>(id, {
		confirmed: true,
		confirm_attempts: (before.confirm_attempts ?? 0) + 1
	});
	await writeAudit(actor, 'confirm_booking', 'geisha_bookings', id, before, after, staffId);
	return after;
}

/**
 * Count a confirmation email the host sent ("Resend confirmation") as a confirm
 * attempt, so the popover's "N attempts" line shows it was done. Only the counter
 * moves — sending an email doesn't mean the guest has confirmed. Audited.
 */
export async function recordConfirmAttempt(
	id: string,
	actor: AuditActor = 'staff',
	/** geisha_staff id of the host who sent it — named in the booking history. */
	staffId?: string
): Promise<Booking> {
	const c = await pb();
	const before = await getBooking(id);
	const after = await c.collection('geisha_bookings').update<Booking>(id, {
		confirm_attempts: (before.confirm_attempts ?? 0) + 1
	});
	await writeAudit(actor, 'resend_confirmation', 'geisha_bookings', id, before, after, staffId);
	return after;
}

/**
 * Set (or clear) a booking's transient PRE-seating holding state — ResDiary's
 * "Waiting in Bar" / "Table Ready" (diary popover left menu). Pass '' to clear it
 * back to normal. Only meaningful before the party is seated; seating/clearing/
 * no-showing the booking elsewhere clears it. Best-effort on the column (silently
 * ignored pre-migration 1772701500). Audited.
 */
export async function setFloorStatus(
	id: string,
	floorStatus: '' | 'waiting_bar' | 'table_ready',
	actor: AuditActor = 'staff',
	/** geisha_staff id of the host who set it — named in the booking history. */
	staffId?: string
): Promise<Booking> {
	const before = await getBooking(id);
	const c = await pb();
	const after = await c
		.collection('geisha_bookings')
		.update<Booking>(id, { floor_status: floorStatus });
	await writeAudit(actor, 'set_floor_status', 'geisha_bookings', id, before, after, staffId);
	return after;
}

/**
 * Reset a booking's arrival back to "to arrive" — ResDiary's reset-arrival (↩) /
 * "Unallocate". Reverts a seated/completed booking to `confirmed`, removes its
 * floor_state rows so the live floor frees the table, and clears any holding state.
 * The booking keeps its reservation (time, party, tables) — only the arrival is
 * undone, so the host can re-seat it. Idempotent for an already-upcoming booking.
 */
export async function resetArrival(
	id: string,
	actor: AuditActor = 'staff',
	/** geisha_staff id of the host who reset it — named in the booking history. */
	staffId?: string
): Promise<Booking> {
	const before = await getBooking(id);
	const c = await pb();
	// Drop every floor_state row for this booking (seated or cleared) so the live
	// floor no longer shows it sat/finished.
	const rows = await c
		.collection('geisha_floor_state')
		.getFullList<FloorState>({ filter: `booking=${q(id)}` });
	for (const row of rows) await c.collection('geisha_floor_state').delete(row.id);
	// Back to an upcoming reservation; clear the holding state too. If a finish had cut
	// this booking short, put its sitting back at the same time — see endsAtBeforeFinish.
	const restoreEnds = await endsAtBeforeFinish(c, id, before);
	const after = await c.collection('geisha_bookings').update<Booking>(id, {
		status: 'confirmed',
		floor_status: '',
		...(restoreEnds ? { ends_at: restoreEnds } : {})
	});
	await writeAudit(actor, 'reset_arrival', 'geisha_bookings', id, before, after, staffId);
	return after;
}

/**
 * The end time a `clear` cut off this booking, if it did — for putting a sitting back
 * when a finish is undone.
 *
 * clearBooking truncates ends_at to when the table was finished (back to the start of that
 * 15-minute cell), deliberately: a finished bar frees the table. Undoing the finish used to
 * restore only the STATUS, so a mis-tapped Finish permanently shortened a LIVE sitting —
 * one tapped five minutes in left a seated party on a 5-minute bar (clearBooking's own
 * floor), and the board then believed the table had freed.
 *
 * The clear writes an audit row holding the booking as it was, so the exact window is
 * recoverable — including a sitting the host had deliberately resized, which recomputing
 * the party's standard turn would silently overwrite. Returns '' when there is nothing to
 * put back: the booking was never finished, the clear didn't truncate (a tidy-up on
 * another day leaves the window alone), or the audit row has gone. Best-effort by design —
 * failing to find it must never block seating a table.
 */
async function endsAtBeforeFinish(
	c: Awaited<ReturnType<typeof pb>>,
	id: string,
	current: Booking
): Promise<string> {
	if (current.status !== 'completed') return '';
	try {
		const row = await c
			.collection('geisha_audit_log')
			.getFirstListItem<{ before?: { ends_at?: string } | null }>(
				`entity_id=${q(id)} && action="clear_booking"`,
				{ sort: '-created' }
			);
		const was = row?.before?.ends_at;
		if (typeof was !== 'string' || !was) return '';
		// Only ever LENGTHEN back to what the clear cut. If the recorded end isn't later
		// than the current one, the clear didn't shorten anything and there is nothing to
		// undo — never let this path move a booking's end backwards.
		return new Date(was).getTime() > new Date(current.ends_at).getTime() ? was : '';
	} catch {
		return '';
	}
}

/** Clear a table: booking completed, floor_state.cleared_at = now. */
export async function clearBooking(
	id: string,
	nowISO: string,
	actor: AuditActor = 'staff',
	/** geisha_staff id of the host who cleared it — named in the booking history. */
	staffId?: string
): Promise<Booking> {
	const before = await getBooking(id);
	const c = await pb();
	const rows = await c
		.collection('geisha_floor_state')
		.getFullList<FloorState>({ filter: `booking=${q(id)}` });
	for (const row of rows) {
		await c.collection('geisha_floor_state').update(row.id, { cleared_at: nowISO });
	}
	// Truncate the sitting to the moment it was finished (ResDiary-parity, owner request):
	// finishing a table cuts its bar so the table frees for the next cover from now on.
	//
	// It cuts BACK, to the start of the 15-minute diary cell the party left in, and never
	// past the booked end. Owner, 2026-09-19: "when you finish the table, make the time
	// block go back, not forward". Cut to the exact minute, a 20:05 finish was drawn out
	// to 20:15 (a bar fills whole cells, barGrid.ts), so the table read as busy for ten
	// minutes after it had emptied — and a party that had overstayed was lengthened, the
	// bar growing on a Finish. The stored end moves with the drawing, not just the bar:
	// a 20:05 end behind a bar drawn to 20:00 would have the create path refuse a walk-in
	// on the free-looking 20:00 cell. The exact minute is kept on floor_state.cleared_at
	// above, which is what the turn predictor measures.
	//
	// Clamped so the bar can never invert or collapse to nothing (min 5 min after the start).
	const startsMs = new Date(before.starts_at).getTime();
	const bookedEndMs = new Date(before.ends_at).getTime();
	const nowMs = new Date(nowISO).getTime();
	const MIN_SITTING_MS = 5 * 60_000;
	const DIARY_CELL_MS = 15 * 60_000;
	const patch: Record<string, unknown> = { status: 'completed', floor_status: '' };
	// Only truncate when "now" is a plausible LIVE finish for this sitting (from just before
	// its start out to a very long service). This is a service-floor action, so clearing a
	// booking from another day (data cleanup) must NOT rewrite its historical window.
	const LIVE_FINISH_WINDOW_MS = 18 * 3_600_000;
	if (
		Number.isFinite(startsMs) &&
		Number.isFinite(nowMs) &&
		nowMs > startsMs - 3_600_000 &&
		nowMs < startsMs + LIVE_FINISH_WINDOW_MS
	) {
		const cellStartMs = Math.floor(nowMs / DIARY_CELL_MS) * DIARY_CELL_MS;
		let endsMs = Math.max(cellStartMs, startsMs + MIN_SITTING_MS);
		if (Number.isFinite(bookedEndMs)) endsMs = Math.min(endsMs, bookedEndMs);
		if (endsMs !== bookedEndMs) patch.ends_at = new Date(endsMs).toISOString();
	}
	const after = await c.collection('geisha_bookings').update<Booking>(id, patch);
	await writeAudit(actor, 'clear_booking', 'geisha_bookings', id, before, after, staffId);
	return after;
}
