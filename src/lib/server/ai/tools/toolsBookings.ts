// Booking-domain tools for the admin assistant: find bookable slots, inspect the
// day's (or a range's) bookings, and the confirm-gated writes that drive the
// booking lifecycle — create, amend, cancel, no-show, seat, clear and seat a
// walk-in. Every tool wraps the SAME server functions the admin UI uses, so the
// AI never invents data and every write audits with the ctx actor (default 'ai')
// and the confirming staff id (onBehalfOf, threaded by the agent at confirm time).
//
// WP-S6-2 OWNS the booking create/cancel/seat lifecycle here — later WPs add to
// other domain modules and do NOT duplicate these.

import { getAvailability } from '$lib/server/booking/index.js';
import {
	createBooking,
	amendBooking,
	cancelBooking,
	markNoShow,
	seatBooking,
	clearBooking,
	confirmBooking,
	BookingError
} from '$lib/server/booking/index.js';
import { getBookingsForDay, getBookingDetail, listTables } from '$lib/server/booking/admin.js';
import { getRestaurant } from '$lib/server/booking/queries.js';
import type { Booking, DiningTable } from '$lib/server/db/types.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

/** Local 'YYYY-MM-DD' and 'HH:mm' for an instant in a given IANA timezone, so a
 *  walk-in created from `nowISO` lands on the right service wall-clock (a UTC
 *  Vercel node would otherwise shift the slot across the BST boundary). */
function localDateTime(instant: Date, tz: string): { date: string; time: string } {
	const date = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(instant);
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(instant);
	return { date, time };
}

/** A compact, model-friendly view of one booking with table labels resolved. */
function summarise(b: Booking, labelOf: Map<string, string>) {
	return {
		id: b.id,
		partySize: b.party_size,
		startsAt: b.starts_at,
		endsAt: b.ends_at,
		status: b.status,
		source: b.source,
		specialRequests: b.special_requests || undefined,
		occasion: b.occasion || undefined,
		tableIds: b.tables ?? [],
		tableLabels: (b.tables ?? []).map((id) => labelOf.get(id) ?? id)
	};
}

/** Booking-domain tools for a brand. */
export function bookingTools(ctx: ToolContext): GeminiTool[] {
	const { brand, nowISO, actor, onBehalfOf: ctxOnBehalfOf } = ctx;

	// Resolve table labels once per request for read summaries.
	const labelMap = async () => {
		const tables = await listTables(brand);
		return new Map<string, string>(tables.map((t: DiningTable) => [t.id, t.label]));
	};

	return [
		// --- READ ---------------------------------------------------------------
		{
			name: 'check_availability',
			kind: 'read',
			description:
				'Find bookable time slots for a date and party size. Returns each available time and which tables would be used (joined tables for big parties).',
			parameters: {
				type: 'object',
				properties: { date: dateStr, partySize: { type: 'integer' } },
				required: ['date', 'partySize']
			},
			run: async ({ date, partySize }: { date: string; partySize: number }) => {
				const result = await getAvailability(brand, date, partySize);
				const labelOf = await labelMap();
				const available = result.slots
					.filter((s) => s.available)
					.map((s) => ({
						time: s.time,
						tableIds: s.tableIds ?? [],
						tableLabels: (s.tableIds ?? []).map((id) => labelOf.get(id) ?? id),
						joined: (s.tableIds ?? []).length > 1
					}));
				return {
					date,
					partySize,
					requiresPhone: result.requiresPhone,
					available,
					anyAvailable: available.length > 0
				};
			}
		},
		{
			name: 'get_bookings_for_day',
			kind: 'read',
			description:
				'List all bookings for a date, with guest name, party size, time and assigned tables. Use this to understand what is already on the floor before suggesting moves.',
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				const bookings = await getBookingsForDay(brand, date);
				const labelOf = await labelMap();
				return bookings.map((b) => ({
					...summarise(b, labelOf),
					name: b.expand?.customer?.name ?? '(unknown)'
				}));
			}
		},
		{
			name: 'get_booking_detail',
			kind: 'read',
			description:
				"Get the full detail of a single booking by its id — guest name, contact, party size, time, status, assigned tables, special requests and occasion.",
			parameters: {
				type: 'object',
				properties: {
					bookingId: { type: 'string', description: 'The booking id (e.g. from get_bookings_for_day).' }
				},
				required: ['bookingId']
			},
			run: async ({ bookingId }: { bookingId: string }) => {
				const b = await getBookingDetail(bookingId);
				const labelOf = await labelMap();
				const customer = b.expand?.customer;
				return {
					...summarise(b, labelOf),
					name: customer?.name ?? '(unknown)',
					email: customer?.email,
					phone: customer?.phone
				};
			}
		},
		{
			name: 'get_bookings_range',
			kind: 'read',
			description:
				'List all bookings across an inclusive range of dates (startDate..endDate), each with guest name, party size, time, status and tables. Use for multi-day overviews.',
			parameters: {
				type: 'object',
				properties: {
					startDate: { ...dateStr, description: "First date in the range, 'YYYY-MM-DD'." },
					endDate: { ...dateStr, description: "Last date in the range (inclusive), 'YYYY-MM-DD'." }
				},
				required: ['startDate', 'endDate']
			},
			run: async ({ startDate, endDate }: { startDate: string; endDate: string }) => {
				// Enumerate calendar dates from start..end (inclusive); cap to guard
				// against an accidentally huge span. Each day reuses the same vetted
				// getBookingsForDay loader the admin UI uses.
				const days: string[] = [];
				const cursor = new Date(`${startDate}T00:00:00Z`);
				const end = new Date(`${endDate}T00:00:00Z`);
				if (isNaN(cursor.getTime()) || isNaN(end.getTime()) || end < cursor) {
					return { startDate, endDate, days: [], bookings: [] };
				}
				for (let i = 0; i < 92 && cursor <= end; i++) {
					days.push(cursor.toISOString().slice(0, 10));
					cursor.setUTCDate(cursor.getUTCDate() + 1);
				}
				const labelOf = await labelMap();
				const perDay = await Promise.all(days.map((d) => getBookingsForDay(brand, d)));
				const bookings = perDay.flat().map((b) => ({
					...summarise(b, labelOf),
					name: b.expand?.customer?.name ?? '(unknown)'
				}));
				return { startDate, endDate, days, bookings };
			}
		},

		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'create_booking',
			kind: 'write',
			description:
				'Create a new reservation (taken by staff, e.g. over the phone). Re-checks table availability before writing and confirms it immediately — no online payment is taken. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					date: { ...dateStr, description: "Booking date, 'YYYY-MM-DD'." },
					time: { type: 'string', description: "Booking time, 'HH:mm' (24h)." },
					partySize: { type: 'integer' },
					name: { type: 'string', description: "Guest's name." },
					email: { type: 'string', description: "Guest's email (optional but preferred)." },
					phone: { type: 'string', description: "Guest's phone number." },
					specialRequests: { type: 'string' },
					occasion: { type: 'string' }
				},
				required: ['date', 'time', 'partySize', 'name']
			},
			run: async (args: {
				date: string;
				time: string;
				partySize: number;
				name: string;
				email?: string;
				phone?: string;
				specialRequests?: string;
				occasion?: string;
			}) => {
				try {
					const { booking } = await createBooking({
						brand,
						date: args.date,
						time: args.time,
						partySize: args.partySize,
						customer: { name: args.name, email: args.email ?? '', phone: args.phone },
						specialRequests: args.specialRequests,
						occasion: args.occasion,
						// Assistant bookings are staff-side (phone): confirmed immediately,
						// no online payment, online party cap relaxed.
						source: 'phone',
						staff: true,
						staffId: ctxOnBehalfOf
					});
					const labelOf = await labelMap();
					return { ok: true, booking: summarise(booking, labelOf) };
				} catch (e) {
					if (e instanceof BookingError) return { ok: false, code: e.code, error: e.message };
					throw e;
				}
			}
		},
		{
			name: 'amend_booking',
			kind: 'write',
			description:
				"Change an existing booking's date, time, party size, special requests or occasion. Re-checks table availability before applying. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					bookingId: { type: 'string' },
					date: { ...dateStr, description: "New date, 'YYYY-MM-DD'. Omit to keep the current date." },
					time: { type: 'string', description: "New time, 'HH:mm'. Omit to keep the current time." },
					partySize: { type: 'integer' },
					specialRequests: { type: 'string' },
					occasion: { type: 'string' }
				},
				required: ['bookingId']
			},
			run: async (
				args: {
					bookingId: string;
					date?: string;
					time?: string;
					partySize?: number;
					specialRequests?: string;
					occasion?: string;
				},
				onBehalfOf?: string
			) => {
				try {
					const { booking, payment, paymentChanged } = await amendBooking({
						...args,
						actor,
						onBehalfOf: onBehalfOf ?? ctxOnBehalfOf
					});
					const labelOf = await labelMap();
					return {
						ok: true,
						booking: summarise(booking, labelOf),
						paymentChanged,
						paymentKind: payment.kind
					};
				} catch (e) {
					if (e instanceof BookingError) return { ok: false, code: e.code, error: e.message };
					throw e;
				}
			}
		},
		{
			name: 'cancel_booking',
			kind: 'write',
			description:
				"Cancel a booking. NEVER charges the guest's card: an in-time cancellation refunds any deposit and releases any hold, and a late one keeps an already-paid deposit but leaves a card on file untouched. Taking a no-show fee is a separate action only a manager can do, in the admin. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: { bookingId: { type: 'string' } },
				required: ['bookingId']
			},
			run: async ({ bookingId }: { bookingId: string }) => {
				const booking = await cancelBooking(bookingId, actor, { staffId: ctxOnBehalfOf });
				const labelOf = await labelMap();
				return { ok: true, booking: summarise(booking, labelOf) };
			}
		},
		{
			name: 'mark_no_show',
			kind: 'write',
			description:
				"Mark a booking as a no-show, so it lands on the no-show report. Does NOT charge the guest's card — that is a separate manager-only action in the admin. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: { bookingId: { type: 'string' } },
				required: ['bookingId']
			},
			run: async ({ bookingId }: { bookingId: string }) => {
				const booking = await markNoShow(bookingId, actor, { staffId: ctxOnBehalfOf });
				const labelOf = await labelMap();
				return { ok: true, booking: summarise(booking, labelOf) };
			}
		},
		{
			name: 'confirm_booking',
			kind: 'write',
			description:
				"Mark a booking as confirmed (e.g. after the guest has reconfirmed by phone) — it then shows as confirmed on the diary's Confirmation colour scheme. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: { bookingId: { type: 'string' } },
				required: ['bookingId']
			},
			run: async ({ bookingId }: { bookingId: string }) => {
				const booking = await confirmBooking(bookingId, actor, ctxOnBehalfOf);
				const labelOf = await labelMap();
				return { ok: true, booking: summarise(booking, labelOf) };
			}
		},
		{
			name: 'seat_booking',
			kind: 'write',
			description:
				"Seat an arriving booking at its assigned table(s): sets it to seated and marks the floor occupied as of now. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: { bookingId: { type: 'string' } },
				required: ['bookingId']
			},
			run: async ({ bookingId }: { bookingId: string }) => {
				const booking = await seatBooking(bookingId, nowISO, actor, undefined, ctxOnBehalfOf);
				const labelOf = await labelMap();
				return { ok: true, booking: summarise(booking, labelOf) };
			}
		},
		{
			name: 'clear_table',
			kind: 'write',
			description:
				'Clear a finished booking from its table(s): marks the booking completed and frees the floor as of now. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: { bookingId: { type: 'string' } },
				required: ['bookingId']
			},
			run: async ({ bookingId }: { bookingId: string }) => {
				const booking = await clearBooking(bookingId, nowISO, actor, ctxOnBehalfOf);
				const labelOf = await labelMap();
				return { ok: true, booking: summarise(booking, labelOf) };
			}
		},
		{
			name: 'seat_walkin',
			kind: 'write',
			description:
				'Seat a walk-in party now at specific free table(s): creates a confirmed walk-in booking on those tables (validated free + big enough) and seats it immediately. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					partySize: { type: 'integer' },
					tableIds: {
						type: 'array',
						items: { type: 'string' },
						description: 'The free table id(s) to seat them on. Use 2+ ids to combine tables.'
					},
					name: { type: 'string', description: 'Walk-in name (optional).' },
					phone: { type: 'string' },
					specialRequests: { type: 'string' }
				},
				required: ['partySize', 'tableIds']
			},
			run: async (args: {
				partySize: number;
				tableIds: string[];
				name?: string;
				phone?: string;
				specialRequests?: string;
			}) => {
				try {
					// The model echoes whatever the user said for the table(s) — almost
					// always a human LABEL ("A10"), not a PocketBase record id. createBooking
					// matches the chosen tables by id, so a raw label silently resolves to
					// zero tables and the walk-in fails the fit/free check (NO_AVAILABILITY) —
					// to staff this looked like a phantom "done" with no booking on the floor.
					// Map label→id here (ids still pass through unchanged) so the seat lands.
					const allTables = await listTables(brand);
					const idByLabel = new Map(
						allTables.map((t) => [t.label.toLowerCase(), t.id] as const)
					);
					const tableIds = args.tableIds.map(
						(ref) => idByLabel.get(ref.trim().toLowerCase()) ?? ref
					);
					// Derive the local 'YYYY-MM-DD' / 'HH:mm' for NOW (in the restaurant
					// timezone) so the walk-in is created at the current service moment,
					// then seated immediately.
					const restaurant = await getRestaurant(brand);
					const { date, time } = localDateTime(
						new Date(nowISO),
						restaurant.timezone || 'Europe/London'
					);
					// Seated as part of the create — seating it from here afterwards raced
					// createBooking's deferred writes and lost (see create.ts).
					const { booking: seated } = await createBooking({
						brand,
						date,
						time,
						partySize: args.partySize,
						customer: { name: args.name?.trim() || 'Walk-in', email: '', phone: args.phone },
						specialRequests: args.specialRequests,
						source: 'walkin',
						staff: true,
						staffId: ctxOnBehalfOf,
						tableIds,
						seat: { at: nowISO, actor }
					});
					const labelOf = await labelMap();
					return { ok: true, booking: summarise(seated, labelOf) };
				} catch (e) {
					if (e instanceof BookingError) return { ok: false, code: e.code, error: e.message };
					throw e;
				}
			}
		}
	];
}
