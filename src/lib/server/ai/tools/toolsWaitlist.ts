// Waitlist-domain tools for the admin assistant (ResDiary W8List). The agent can
// read today's queue and manage it: add a walk-in party, notify a party their
// table is ready ("Send"), seat/convert a party into a booking, and remove an
// entry. All wrap the SAME server functions the diary's waitlist panel uses, so
// the AI never invents queue entries and every write audits with the ctx actor.
//
// Registered in the composer (./index.ts) — adding a tool here is the only change.

import {
	listWaitlist,
	addWaitlistWalkIn,
	markWaitlistOffered,
	markWaitlistClaimed,
	cancelWaitlistEntry,
	createBooking,
	WaitlistError,
	BookingError
} from '$lib/server/booking/index.js';
import { getRestaurant } from '$lib/server/booking/queries.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

/** Local 'YYYY-MM-DD' / 'HH:mm' for an instant in a timezone (for "seat now"). */
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

const HHMM = (v: string) => {
	if (!v) return '';
	if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
	const d = new Date(v);
	return isNaN(d.getTime())
		? ''
		: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });
};

/** Waitlist-domain tools for a brand. */
export function waitlistTools(ctx: ToolContext): GeminiTool[] {
	const { brand, nowISO, actor, onBehalfOf } = ctx;

	return [
		// --- READ ---------------------------------------------------------------
		{
			name: 'get_waitlist',
			kind: 'read',
			description:
				"The walk-in WAITLIST for a date — parties queuing for a table. Each entry: id, guest name + phone, party size, the time window they'll accept, and status (waiting / offered = already notified their table is ready). Use for 'who's on the waitlist?', 'anyone waiting for a 4-top?', 'who have we already texted?'. Resolve relative dates first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				const rows = (await listWaitlist(brand, date)).filter(
					(w) => w.status === 'waiting' || w.status === 'offered'
				);
				return {
					date,
					count: rows.length,
					waitlist: rows.map((w) => ({
						id: w.id,
						guest: w.expand?.customer?.name ?? 'Walk-in',
						phone: w.expand?.customer?.phone ?? '',
						partySize: w.party_size,
						windowFrom: HHMM(w.window_from),
						windowTo: HHMM(w.window_to),
						status: w.status,
						notified: w.status === 'offered'
					}))
				};
			}
		},

		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'add_to_waitlist',
			kind: 'write',
			description:
				"Add a walk-in party to today's waitlist (they wait for a table to free up). Give their name, party size and the time window they'll accept. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					date: { ...dateStr, description: "Date, 'YYYY-MM-DD' (usually today)." },
					name: { type: 'string', description: 'Guest / walk-in name.' },
					partySize: { type: 'integer' },
					phone: { type: 'string', description: 'Phone (so we can text them when ready).' },
					windowFrom: { type: 'string', description: "Earliest acceptable time 'HH:mm'." },
					windowTo: { type: 'string', description: "Latest acceptable time 'HH:mm'." }
				},
				required: ['date', 'name', 'partySize', 'windowFrom', 'windowTo']
			},
			run: async (args: {
				date: string;
				name: string;
				partySize: number;
				phone?: string;
				windowFrom: string;
				windowTo: string;
			}) => {
				try {
					const row = await addWaitlistWalkIn({
						brand,
						date: args.date,
						partySize: args.partySize,
						windowFrom: args.windowFrom,
						windowTo: args.windowTo,
						customer: { name: args.name, phone: args.phone }
					});
					return { ok: true, id: row.id, guest: args.name, partySize: args.partySize };
				} catch (e) {
					if (e instanceof WaitlistError) return { ok: false, error: e.message };
					throw e;
				}
			}
		},
		{
			name: 'notify_waitlist',
			kind: 'write',
			description:
				'Notify a waiting party that their table is ready ("Send") — flips their waitlist entry to offered and stamps the time. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'The waitlist entry id from get_waitlist.' } },
				required: ['id']
			},
			run: async ({ id }: { id: string }) => {
				await markWaitlistOffered(id, nowISO, actor);
				return { ok: true, id, status: 'offered' };
			}
		},
		{
			name: 'seat_from_waitlist',
			kind: 'write',
			description:
				'Seat a waiting party now: creates a confirmed walk-in booking at the current time (auto-allocating a free table that fits) and marks their waitlist entry claimed. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'The waitlist entry id from get_waitlist.' },
					name: { type: 'string', description: 'Guest name (optional — used on the booking).' },
					partySize: { type: 'integer', description: 'Party size (from the waitlist entry).' },
					phone: { type: 'string' }
				},
				required: ['id', 'partySize']
			},
			run: async (args: { id: string; name?: string; partySize: number; phone?: string }) => {
				try {
					const restaurant = await getRestaurant(brand);
					const { date, time } = localDateTime(new Date(nowISO), restaurant.timezone || 'Europe/London');
					const { booking } = await createBooking({
						brand,
						date,
						time,
						partySize: args.partySize,
						customer: { name: args.name?.trim() || 'Walk-in', email: '', phone: args.phone },
						source: 'walkin',
						staff: true,
						staffId: onBehalfOf
					});
					await markWaitlistClaimed(args.id, actor);
					return { ok: true, bookingId: booking.id, seatedAt: time };
				} catch (e) {
					if (e instanceof BookingError) return { ok: false, code: e.code, error: e.message };
					throw e;
				}
			}
		},
		{
			name: 'convert_waitlist',
			kind: 'write',
			description:
				"Convert a waiting party into a future RESERVATION (hold them a table for a specific time, rather than seating them now). Give the date + time to book for (usually their window-start). Marks the waitlist entry claimed. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'The waitlist entry id from get_waitlist.' },
					date: { ...dateStr, description: "Reservation date, 'YYYY-MM-DD'." },
					time: { type: 'string', description: "Reservation time, 'HH:mm' (e.g. their window-start)." },
					partySize: { type: 'integer' },
					name: { type: 'string' },
					phone: { type: 'string' }
				},
				required: ['id', 'date', 'time', 'partySize']
			},
			run: async (args: {
				id: string;
				date: string;
				time: string;
				partySize: number;
				name?: string;
				phone?: string;
			}) => {
				try {
					const { booking } = await createBooking({
						brand,
						date: args.date,
						time: args.time,
						partySize: args.partySize,
						customer: { name: args.name?.trim() || 'Walk-in', email: '', phone: args.phone },
						occasion: 'Converted from waitlist',
						source: 'phone',
						staff: true,
						staffId: onBehalfOf
					});
					await markWaitlistClaimed(args.id, actor);
					return { ok: true, bookingId: booking.id, reservedFor: args.time };
				} catch (e) {
					if (e instanceof BookingError) return { ok: false, code: e.code, error: e.message };
					throw e;
				}
			}
		},
		{
			name: 'remove_from_waitlist',
			kind: 'write',
			description:
				'Remove a party from the waitlist (they left or no longer want to wait). WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'The waitlist entry id from get_waitlist.' } },
				required: ['id']
			},
			run: async ({ id }: { id: string }) => {
				await cancelWaitlistEntry(id, actor);
				return { ok: true, id, status: 'cancelled' };
			}
		}
	];
}
