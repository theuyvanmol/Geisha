// Reports-domain tools for the admin assistant. WP-CRM-5 adds get_covers_report
// (a READ tool wrapping the same getCoversReport the /admin/reports page uses, so
// the AI never invents numbers). WP-S6-4 ports get_dashboard from the retired
// Claude stack — today-at-a-glance covers/seated/pending for a date. WP-CRM-6 adds
// get_noshow_report (wraps getNoShowReport) so the AI can answer "what's our
// no-show rate" with real, per-channel figures. Registered in the composer
// (./index.ts) — adding a tool here is the only change needed.

import { getCoversReport, getNoShowReport } from '$lib/server/booking/reporting.js';
import { getDashboard } from '$lib/server/booking/admin.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

/** Reports-domain tools for a brand. */
export function reportTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'get_dashboard',
			kind: 'read',
			description:
				"Today-at-a-glance numbers for a single date: total live bookings, total covers, how many of those were walk-ins (and their covers), how many parties are currently seated, how many are awaiting payment, and the next upcoming arrivals (guest name, party size, time, status). Use this to answer 'how busy are we today' or 'who's coming in next'. Resolve relative phrases like 'today' to an absolute YYYY-MM-DD date first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				const d = await getDashboard(brand, date);
				return {
					date: d.date,
					totalBookings: d.totalBookings,
					totalCovers: d.totalCovers,
					seated: d.seated,
					pendingPayment: d.pendingPayment,
					// Included in totalBookings/totalCovers, not additional to them.
					walkins: d.walkins,
					walkinCovers: d.walkinCovers,
					upcoming: d.upcoming.map((b) => ({
						id: b.id,
						name: b.expand?.customer?.name ?? '(unknown)',
						partySize: b.party_size,
						startsAt: b.starts_at,
						status: b.status
					}))
				};
			}
		},
		{
			name: 'get_covers_report',
			kind: 'read',
			description:
				"Covers and seat-utilisation over a date range: total covers, bookings, average party size, cancellations and no-shows, broken down by day and by service period. Use this to answer 'how many covers did we do last weekend' or 'which service is busiest'. Resolve relative phrases like 'last week' to absolute YYYY-MM-DD dates first.",
			parameters: {
				type: 'object',
				properties: { from: dateStr, to: dateStr },
				required: ['from', 'to']
			},
			run: async ({ from, to }: { from: string; to: string }) => {
				const report = await getCoversReport(brand, from, to);
				return {
					from: report.from,
					to: report.to,
					totals: report.totals,
					byDay: report.byDay,
					byPeriod: report.byPeriod,
					// Occupancy summarised — utilisation rounded to a percentage so the
					// model reads it cleanly without the raw capacity arithmetic.
					occupancy: report.occupancy.map((o) => ({
						date: o.date,
						periodId: o.periodId,
						coversSeated: o.coversSeated,
						capacity: o.capacity,
						utilisationPct: Math.round(o.utilisation * 100)
					}))
				};
			}
		},
		{
			name: 'get_noshow_report',
			kind: 'read',
			description:
				"No-show and cancellation rate over a date range, with a per-channel breakdown. Answers 'what's our no-show rate over the last N days' or 'which booking channel no-shows most'. Rates are computed over RESOLVED bookings only (honoured + cancelled + no-show) — live/future bookings are excluded so the rate reflects realised outcomes. Returns totals, byChannel (online/phone/walk-in/AI) and byDay, with each rate as a rounded percentage. Resolve relative phrases like 'last 30 days' to absolute YYYY-MM-DD dates first.",
			parameters: {
				type: 'object',
				properties: { from: dateStr, to: dateStr },
				required: ['from', 'to']
			},
			run: async ({ from, to }: { from: string; to: string }) => {
				const report = await getNoShowReport(brand, from, to);
				// Rates surfaced as rounded percentage ints (like the covers tool rounds
				// utilisationPct) so the model reads them cleanly without the raw ratio.
				return {
					from: report.from,
					to: report.to,
					totals: {
						resolved: report.totals.resolved,
						honoured: report.totals.honoured,
						cancelled: report.totals.cancelled,
						noShows: report.totals.noShows,
						noShowRatePct: Math.round(report.totals.noShowRate * 100),
						cancelRatePct: Math.round(report.totals.cancelRate * 100)
					},
					byChannel: report.byChannel.map((c) => ({
						source: c.source,
						label: c.label,
						resolved: c.resolved,
						honoured: c.honoured,
						cancelled: c.cancelled,
						noShows: c.noShows,
						noShowRatePct: Math.round(c.noShowRate * 100)
					})),
					byDay: report.byDay.map((d) => ({
						date: d.date,
						resolved: d.resolved,
						noShows: d.noShows,
						cancelled: d.cancelled,
						noShowRatePct: Math.round(d.noShowRate * 100)
					}))
				};
			}
		}
	];
}
