// ONE assembly of "everything the diary shows for a given day", shared by the
// diary page loader and the /api/admin/diary-day prefetch endpoint.
//
// WHY it was lifted out of +page.server.ts (owner: "changing days feels slow"):
// a day step used to be a full SvelteKit navigation and the board simply froze
// until the loader's cross-region PocketBase round-trips came back. The client
// now keeps a small cache of days and paints a cached day INSTANTLY, warming the
// neighbouring days in the background through this same code path — so the
// prefetch and the real navigation cannot drift out of sync, because they run
// the identical function.
//
// Everything in here is day-scoped. Account-scoped state (the staffer's UI
// prefs) and request-scoped state (`today`, `brand`) stay in the page loader.

import {
	getBookingsForDay,
	getDiaryTimeline,
	listBookableAreas,
	listPeriods,
	listPeriodsForDate,
	listClosures,
	getCloseouts,
	getTableCloseouts
} from '$lib/server/booking/admin.js';
import { listWaitlist } from '$lib/server/booking/index.js';
import { getRestaurant } from '$lib/server/booking/queries.js';
import { pb } from '$lib/server/db/pb.js';
import {
	forecastForDate,
	PACING_CURVE_KEY,
	type PacingCurve,
	type DateForecast
} from '$lib/server/ai/forecast.js';
import type { Setting } from '$lib/server/db/types.js';
import type { BrandId } from '$lib/server/db/types.js';

const qf = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export type DiaryClosure = {
	closedFull: boolean;
	fullReason: string;
	active: {
		id: string;
		scope: 'full' | 'period';
		periodId: string;
		reason: string;
		kind: string;
	}[];
	periods: {
		id: string;
		name: string;
		start: string;
		end: string;
		lastBooking: string;
	}[];
};

const CLOSURE_OPEN: DiaryClosure = {
	closedFull: false,
	fullReason: '',
	active: [],
	periods: []
};

/**
 * What the Cancellation List can say about WHY and WHEN a booking died.
 *
 * There is no `cancel_reason` / `cancelled_at` column on the booking (see
 * cancelBooking): the reason the host picked is folded into the audit row's
 * `after` snapshot as `_cancellation`, and the audit row's own `created` is the
 * moment it happened. So the list joins the audit trail rather than the booking.
 */
export type CancellationMeta = {
	/** Reason code, e.g. 'guest_request' ('' when none was recorded). */
	reason: string;
	/** Human label for the code — what the list actually prints. */
	reasonLabel: string;
	/** ISO timestamp the cancellation was recorded. */
	at: string;
	/** Was the guest emailed about it? */
	notified: boolean;
	/** Who did it: 'staff' | 'ai' | 'system' | 'customer'. */
	by: string;
	/** True for the late-cancel action (deposit forfeited / fee captured). */
	late: boolean;
};

/** Actions that END a booking, newest-first, for the cancellation join below. */
const CANCEL_ACTIONS = ['cancel_booking', 'cancel_late', 'no_show', 'expire_unpaid_hold'];

/**
 * Join the audit trail to the day's cancelled / no-show bookings so the
 * Cancellation List can show a reason and a cancellation date. One extra read,
 * only when the day HAS cancellations, and it degrades to `{}` — the list still
 * renders (falling back to the booking's own `updated` for the date).
 */
async function loadCancellationMeta(
	bookingIds: string[]
): Promise<Record<string, CancellationMeta>> {
	if (!bookingIds.length) return {};
	// Keep the PB filter to a sane length on a catastrophically bad day.
	const ids = bookingIds.slice(0, 80);
	try {
		const c = await pb();
		const idFilter = ids.map((id) => `entity_id=${qf(id)}`).join(' || ');
		const actionFilter = CANCEL_ACTIONS.map((a) => `action=${qf(a)}`).join(' || ');
		const rows = await c.collection('geisha_audit_log').getFullList<{
			action: string;
			actor: string;
			entity_id: string;
			created: string;
			after?: unknown;
		}>({
			filter: `entity=${qf('geisha_bookings')} && (${actionFilter}) && (${idFilter})`,
			sort: '-created'
		});
		const out: Record<string, CancellationMeta> = {};
		for (const r of rows) {
			// Sorted newest-first, so the FIRST row seen for a booking is the one that
			// killed it — a booking cancelled, reinstated and cancelled again reads as
			// its latest cancellation.
			if (out[r.entity_id]) continue;
			const meta =
				r.after && typeof r.after === 'object'
					? ((r.after as Record<string, unknown>)._cancellation as
							| { reason?: string; reasonLabel?: string; notified?: boolean }
							| undefined)
					: undefined;
			const fallbackLabel =
				r.action === 'no_show'
					? 'No-show'
					: r.action === 'expire_unpaid_hold'
						? 'Payment not completed'
						: '';
			out[r.entity_id] = {
				reason: meta?.reason ?? '',
				reasonLabel: meta?.reasonLabel || fallbackLabel,
				at: r.created,
				notified: meta?.notified ?? false,
				by: r.actor || '',
				late: r.action === 'cancel_late'
			};
		}
		return out;
	} catch {
		return {}; // never block the diary on the audit read
	}
}

/** Load the stored demand-forecast curve for a restaurant, or null if absent. */
async function loadCurve(restaurantId: string): Promise<PacingCurve | null> {
	const c = await pb();
	try {
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${qf(restaurantId)} && key=${qf(PACING_CURVE_KEY)}`);
		const v = row.value;
		return v && typeof v === 'object' ? (v as PacingCurve) : null;
	} catch {
		return null; // cron hasn't run yet — the bar falls back to cold-start.
	}
}

/**
 * Assemble the whole diary payload for ONE day. Every sub-read degrades to a
 * safe default on its own error, so a flaky closure/forecast read never blocks
 * the board.
 */
export async function loadDiaryDay(opts: {
	brand: BrandId;
	date: string;
	floorId?: string;
	/** "now" for the timeline's live cursor/state derivation. Defaults to this instant. */
	nowISO?: string;
}) {
	const { brand, date, floorId } = opts;
	const nowISO = opts.nowISO ?? new Date().toISOString();

	// PERF: these five reads are independent (each degrades on its own error), so run
	// them as ONE parallel wave instead of five serial cross-region round-trips. On the
	// iad1→London hop that's ~5×85ms → ~85ms. The timeline + forecast blocks below
	// stay after this because they're heavier and (timeline) internally parallelised.
	const [bookings, waitlistRaw, areas, closeouts, tableCloseouts] = await Promise.all([
		getBookingsForDay(brand, date),
		listWaitlist(brand, date).catch(() => []),
		listBookableAreas(brand).catch(() => []),
		getCloseouts(brand, date).catch(() => []),
		getTableCloseouts(brand, date).catch(() => [])
	]);
	// In-service waitlist (ResDiary W8List): today's queue, only the live entries.
	const waitlist = waitlistRaw.filter((w) => w.status === 'waiting' || w.status === 'offered');

	// date_from/date_to are PB `date` fields (full datetimes) — slice to the bare day
	// before the calendar compare.
	const day = (v: string | undefined) => (v || '').slice(0, 10);

	// PERF: the closure banner, the ResDiary timeline grid, and the demand-forecast
	// pacing bar are three INDEPENDENT server assemblies (the timeline was ~14 round-
	// trips on its own). Previously each was a sequential try/catch await, so their
	// latencies STACKED. Run all three concurrently — the loader now waits on the
	// slowest one (the timeline), not the sum. Each still degrades to its safe default
	// on its own error without failing the others.
	const [closure, timeline, forecast, cancellationMeta] = await Promise.all([
		// Closures touching this date (ResDiary "Service Closures"): the diary shows a
		// red "Closed" banner, lets the host remove a closure or add one (whole-day or a
		// single service) inline, and suppresses the new-booking affordances for a closed
		// service. We load the FULL rows (listClosures) rather than the pure engine rules,
		// because the diary needs each row's id to offer "Remove", and the day's service
		// periods (with their time bounds) so the client can map a clicked slot to its
		// period and block a create that lands in a closed service.
		(async (): Promise<DiaryClosure> => {
			try {
				// Only the services that RUN on this date — the tabs in the create modals,
				// the slot→period mapping and the close-out form all read this list.
				const [rows, periods] = await Promise.all([
					listClosures(brand),
					listPeriodsForDate(brand, date)
				]);
				const spans = (c: { date_from: string; date_to?: string }) => {
					const from = day(c.date_from);
					const to = day(c.date_to) || from;
					return from <= date && date <= to;
				};
				const active = rows
					.filter((c) => (c.scope === 'full' || c.scope === 'period') && spans(c))
					.map((c) => ({
						id: c.id,
						scope: c.scope as 'full' | 'period',
						periodId: c.service_period || '',
						reason: c.reason || '',
						kind: c.kind || 'holiday'
					}));
				const full = active.find((c) => c.scope === 'full');
				return {
					closedFull: !!full,
					fullReason: full?.reason ?? '',
					active,
					periods: periods.map((p) => ({
						id: p.id,
						name: p.name,
						start: p.start_time,
						end: p.end_time,
						lastBooking: p.last_booking_time
					}))
				};
			} catch {
				return CLOSURE_OPEN; // never block the diary on a closure read
			}
		})(),
		// MF-DIARY-TIMELINE — ResDiary-style grid. Degrades to null rather than failing.
		getDiaryTimeline(brand, date, nowISO, floorId).catch(() => null),
		// MF-DEMAND-FORECAST — additive pacing bar. Degrades to a cold-start forecast
		// (or null) if anything goes wrong — never blocks the diary.
		(async (): Promise<DateForecast | null> => {
			try {
				const restaurant = await getRestaurant(brand);
				const [curve, periods] = await Promise.all([loadCurve(restaurant.id), listPeriods(brand)]);
				return forecastForDate(date, curve, periods);
			} catch {
				return null;
			}
		})(),
		// Cancellation List (ResDiary): the reason + when it was cancelled live on the
		// audit trail, not the booking, so they're joined here. Rides in this wave so it
		// costs nothing next to the timeline read.
		loadCancellationMeta(
			bookings
				.filter((b) => b.status === 'cancelled' || b.status === 'no_show')
				.map((b) => b.id)
		)
	]);

	// Booked covers per period (live bookings only), for the bar's "booked" figure.
	const bookedByPeriod: Record<string, number> = {};
	for (const b of bookings) {
		if (b.status === 'cancelled' || b.status === 'no_show') continue;
		const pid = b.service_period || '';
		bookedByPeriod[pid] = (bookedByPeriod[pid] ?? 0) + (b.party_size || 0);
	}

	const pacing = forecast
		? forecast.periods.map((p) => {
				const booked = bookedByPeriod[p.periodId] ?? 0;
				const cap = p.recommendedPeriodCap || 0;
				return {
					periodId: p.periodId,
					periodName: p.periodName,
					booked,
					expected: p.expectedCovers,
					cap,
					fillPct: cap > 0 ? Math.min(100, Math.round((booked / cap) * 100)) : 0,
					coldStart: p.coldStart
				};
			})
		: [];

	return {
		date,
		// Echoed back so the client can key its day cache on the whole view (a date on
		// another floor is a different board) without re-parsing the URL.
		floor: floorId ?? '',
		bookings,
		/** bookingId → why/when it was cancelled (Cancellation List). */
		cancellationMeta,
		timeline,
		waitlist,
		areas,
		closeouts,
		tableCloseouts,
		pacing,
		closure,
		forecastColdStart: forecast?.coldStart ?? true,
		forecastGeneratedAt: forecast?.generatedAt ?? null
	};
}

/** The exact shape the diary page's day-scoped state holds. */
export type DiaryDayPayload = Awaited<ReturnType<typeof loadDiaryDay>>;
