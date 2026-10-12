// Diary-domain READ tools for the admin assistant. These give the agent the SAME
// view a manager has on the /admin/diary timeline (rows = tables by section,
// columns = time, bookings as bars with arrival status + channel + flags), plus
// diary-specific intelligence the raw booking/floor tools don't expose:
//   - get_diary        : the whole timeline, summarised for the model
//   - find_table_gaps  : free time windows per table (where to drop a walk-in / move a party)
//   - who_is_late      : booked-but-not-arrived parties past their slot
//   - suggest_seating  : which free tables + times fit a party (ties a request to a cell)
//
// All wrap the SAME server functions the diary page uses (getDiaryTimeline,
// getBookingsForDay, getAvailability) so the AI never invents bookings or tables.
// They are READS — the lifecycle WRITES (create_booking, seat_booking, move_booking,
// clear_table, seat_walkin) already live in toolsBookings/toolsFloor and are reused.

import { getDiaryTimeline, listPeriods } from '$lib/server/booking/admin.js';
import { getAvailability } from '$lib/server/booking/index.js';
import { getRestaurant } from '$lib/server/booking/queries.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

const HHMM = (iso: string) =>
	new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'Europe/London'
	});

const minutesBetween = (aIso: string, bIso: string) =>
	Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60_000);

/** Diary-domain tools for a brand. */
export function diaryTools(ctx: ToolContext): GeminiTool[] {
	const { brand, nowISO } = ctx;

	return [
		{
			name: 'get_diary',
			kind: 'read',
			description:
				"The service DIARY for a date — exactly what a manager sees on the timeline: every table grouped by its floor SECTION (e.g. 'Front right section'), each booking shown as a bar with guest name, party size, time range, ARRIVAL STATUS (to_arrive / arrived / late / left / partially_seated / no_show) and booking CHANNEL (Online, ResPhone, Walk-in…). Also returns per-15-min covers, per-period pax totals, joined-table sets, and which tables are currently empty. Use this for 'show me tonight's diary', 'who's in the VIP section', 'how does service look', 'which tables are empty at 8pm'. Resolve 'tonight'/'today' to a YYYY-MM-DD first.",
			parameters: {
				type: 'object',
				properties: {
					date: dateStr,
					section: {
						type: 'string',
						description: 'Optional — only return rows in this section (exact name, e.g. "Middle section").'
					}
				},
				required: ['date']
			},
			run: async ({ date, section }: { date: string; section?: string }) => {
				const tl = await getDiaryTimeline(brand, date, nowISO);
				const wanted = section?.trim().toLowerCase();
				const sections = tl.sections
					.filter((s) => !wanted || (s.name || 'Unassigned').toLowerCase() === wanted)
					.map((s) => ({
						section: s.name || 'Unassigned',
						tables: s.rows.map((r) => ({
							table: r.label,
							seats: r.seatsMax,
							joinedWith: r.joinedWith?.length ? r.joinedWith : undefined,
							bookings: r.bars.map((b) => ({
								bookingId: b.bookingId,
								guest: b.guestName,
								party: b.partySize,
								from: HHMM(b.startsAt),
								to: HHMM(b.endsAt),
								arrival: b.arrival,
								channel: b.channel,
								firstVisit: b.firstVisit || undefined
							})),
							empty: r.bars.length === 0 || undefined
						}))
					}));
				return {
					date,
					window: { from: HHMM(new Date(tl.startMs).toISOString()), to: HHMM(new Date(tl.endMs).toISOString()) },
					bookingCount: tl.bookingCount,
					covers: tl.covers,
					periodTotals: tl.periodTotals.map((p) => ({ period: p.name, covers: p.covers })),
					sections
				};
			}
		},

		{
			name: 'find_table_gaps',
			kind: 'read',
			description:
				"Free time WINDOWS on each table for a date — the gaps between its bookings within service hours. Use this to answer 'where can I fit a walk-in at 7?', 'which table is free between 6 and 8?', or to find a home before moving a party. Returns, per table (optionally filtered to a section or a minimum party size it must seat), the open [from–to] windows. Resolve relative dates first.",
			parameters: {
				type: 'object',
				properties: {
					date: dateStr,
					minSeats: {
						type: 'integer',
						description: 'Optional — only tables that seat at least this many (matches a party size).'
					},
					section: { type: 'string', description: 'Optional — restrict to one section by exact name.' }
				},
				required: ['date']
			},
			run: async ({ date, minSeats, section }: { date: string; minSeats?: number; section?: string }) => {
				const tl = await getDiaryTimeline(brand, date, nowISO);
				const wanted = section?.trim().toLowerCase();
				const openFrom = new Date(tl.startMs).toISOString();
				const openTo = new Date(tl.endMs).toISOString();
				const rows: Array<{ table: string; section: string; seats: number; gaps: { from: string; to: string }[] }> = [];
				for (const s of tl.sections) {
					if (s.name === 'Unassigned') continue;
					if (wanted && (s.name || '').toLowerCase() !== wanted) continue;
					for (const r of s.rows) {
						if (minSeats && r.seatsMax < minSeats) continue;
						// build occupied intervals from the bars, then invert within service hours
						const busy = r.bars
							.map((b) => ({ from: b.startsAt, to: b.endsAt }))
							.sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
						const gaps: { from: string; to: string }[] = [];
						let cursor = openFrom;
						for (const iv of busy) {
							if (minutesBetween(cursor, iv.from) >= 15) gaps.push({ from: HHMM(cursor), to: HHMM(iv.from) });
							if (new Date(iv.to).getTime() > new Date(cursor).getTime()) cursor = iv.to;
						}
						if (minutesBetween(cursor, openTo) >= 15) gaps.push({ from: HHMM(cursor), to: HHMM(openTo) });
						rows.push({ table: r.label, section: s.name || 'Unassigned', seats: r.seatsMax, gaps });
					}
				}
				return { date, openHours: { from: HHMM(openFrom), to: HHMM(openTo) }, tables: rows };
			}
		},

		{
			name: 'who_is_late',
			kind: 'read',
			description:
				"Parties on the diary for a date that are running LATE — confirmed/booked but not yet seated, whose booked time is already past (by the grace period). Returns each late guest, party size, table(s), booked time and how many minutes overdue. Use for 'who's late?', 'anyone we should chase?', 'which tables are we holding'. For a future date nothing is late. Resolve relative dates first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				const tl = await getDiaryTimeline(brand, date, nowISO);
				const now = new Date(nowISO).getTime();
				const late: Array<{
					bookingId: string;
					guest: string;
					party: number;
					table: string;
					section: string;
					bookedFor: string;
					minutesLate: number;
				}> = [];
				const seen = new Set<string>();
				for (const s of tl.sections) {
					for (const r of s.rows) {
						for (const b of r.bars) {
							if (b.arrival !== 'late' || seen.has(b.bookingId)) continue;
							seen.add(b.bookingId);
							late.push({
								bookingId: b.bookingId,
								guest: b.guestName,
								party: b.partySize,
								table: r.label,
								section: s.name || 'Unassigned',
								bookedFor: HHMM(b.startsAt),
								minutesLate: Math.max(0, Math.round((now - new Date(b.startsAt).getTime()) / 60_000))
							});
						}
					}
				}
				late.sort((a, b) => b.minutesLate - a.minutesLate);
				return { date, lateCount: late.length, late };
			}
		},

		{
			name: 'suggest_seating',
			kind: 'read',
			description:
				"For a party at a date, which TIMES are bookable and which TABLES would seat them — the data behind 'can we fit 4 at 8pm tonight?' or 'find me a table for 6 this Saturday'. Returns each available time slot with the tables that would be allocated (staff availability — the online cap and booking horizon are relaxed, but physical table fit + existing bookings + closures still apply). If a time is given, it's highlighted. After this, propose a create_booking (which must be confirmed). Resolve relative dates first.",
			parameters: {
				type: 'object',
				properties: {
					date: dateStr,
					partySize: { type: 'integer', description: 'Number of guests.' },
					time: { type: 'string', description: "Optional preferred time 'HH:mm' to check / highlight." }
				},
				required: ['date', 'partySize']
			},
			run: async ({ date, partySize, time }: { date: string; partySize: number; time?: string }) => {
				const avail = await getAvailability(brand, date, partySize, { staff: true });
				if (avail.closed) return { date, partySize, closed: true, reason: avail.closureReason ?? 'Closed.' };
				const slots = avail.slots
					.filter((s) => s.available)
					.map((s) => ({ time: s.time, tables: s.tableIds ?? [] }));
				const exact = time ? slots.find((s) => s.time === time) ?? null : null;
				return {
					date,
					partySize,
					requiresPhone: avail.requiresPhone || undefined,
					requestedTime: time,
					requestedTimeAvailable: time ? !!exact : undefined,
					availableTimes: slots.map((s) => s.time),
					// the tables for the requested time (or the first few slots) so the model
					// can name a concrete table without a second call
					tablesForRequestedTime: exact?.tables,
					firstSlots: slots.slice(0, 6)
				};
			}
		},

		{
			name: 'get_service_periods',
			kind: 'read',
			description:
				"The venue's service PERIODS (e.g. Lunch 12:00–17:00, Dinner 17:00–23:00) with their hours, last-booking time, default turn length and which days they run. Use to ground answers about opening hours, 'when does dinner start', or to pick a sensible time. Static config — no date needed.",
			parameters: { type: 'object', properties: {}, required: [] },
			run: async () => {
				const periods = await listPeriods(brand);
				const restaurant = await getRestaurant(brand);
				return {
					timezone: restaurant.timezone || 'Europe/London',
					periods: periods
						.filter((p) => p.active)
						.map((p) => ({
							name: p.name,
							from: p.start_time,
							to: p.end_time,
							lastBooking: p.last_booking_time,
							turnMinutes: p.default_turn_minutes,
							days: p.days_of_week
						}))
				};
			}
		}
	];
}
