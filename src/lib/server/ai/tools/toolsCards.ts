// Visual-result tools for the admin assistant: show_bookings + show_report.
//
// These are UI-kind (render-only) tools. Like open_settings they auto-run in the
// agent loop and push a UiDirective { tool, input, result } back to the client;
// the shared store (assistant.svelte.ts) routes any directive whose result has a
// `.kind` to a dismissable RESULT CARD (AssistantResultCard.svelte) rendered
// beside the chat. They CHANGE NOTHING — they re-read the SAME server aggregations
// the working read tools + admin pages use and shape the rows for a compact table
// / card, so "who's in tonight?" or "no-show rate this month?" render as a glanceable
// visual instead of a wall of prose.
//
//  · show_bookings { date } → { kind:'bookings-table', date, rows:[{time,name,party,table,status}] }
//    (from getBookingsForDay — the whole day's live service list).
//  · show_report { from, to, metric } → { kind:'report', metric, ... } (covers or
//    no-show summary over a range, from getCoversReport / getNoShowReport).
//
// NB: show_report surfaces commercial figures, so it's in the Ask-path MANAGER_ONLY
// denylist (admin-chat/+server.ts) alongside the underlying report reads. Server-only;
// registered in the composer (./index.ts). Kept in its OWN factory so each stream's
// tools stay disjoint and easy to merge.

import { getBookingsForDay } from '$lib/server/booking/admin.js';
import { getCoversReport, getNoShowReport } from '$lib/server/booking/reporting.js';
import { listTables } from '$lib/server/booking/admin.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

/** Pretty 'HH:mm' in the restaurant timezone. */
function fmtTime(iso: string): string {
	return new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/London'
	});
}

/** Visual-result tools for a brand. */
export function cardTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'show_bookings',
			kind: 'ui',
			description:
				"Show the day's bookings as a compact VISUAL TABLE beside the chat (time, guest, party size, table, arrival status). Prefer this over listing bookings in prose when the operator asks 'who's in tonight?', 'show me today's bookings' or 'what's the book for Saturday?' — the table is far easier to scan. Resolve relative phrases like 'tonight'/'today' to an absolute YYYY-MM-DD first. This only DISPLAYS — it changes nothing.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					throw new Error("Date must be 'YYYY-MM-DD'.");
				}
				const [bookings, tables] = await Promise.all([
					getBookingsForDay(brand, date),
					listTables(brand).catch(() => [])
				]);
				const labelById = new Map(tables.map((t) => [t.id, t.label]));
				// Live service only — drop cancelled / no-show from the visual board.
				const live = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show');
				const rows = live.map((b) => ({
					bookingId: b.id,
					time: fmtTime(b.starts_at),
					name: b.expand?.customer?.name?.trim() || `${b.party_size}p (no name)`,
					party: b.party_size,
					table: (b.tables ?? []).map((id) => labelById.get(id) ?? id).join(', ') || '—',
					status: b.status
				}));
				return {
					kind: 'bookings-table',
					date,
					totalBookings: rows.length,
					totalCovers: live.reduce((n, b) => n + (b.party_size || 0), 0),
					rows
				};
			}
		},
		{
			name: 'show_report',
			kind: 'ui',
			description:
				"Show a metrics REPORT as a compact VISUAL CARD beside the chat over a date range. metric 'covers' = total covers, bookings, average party size, cancellations and no-shows; metric 'noshow' = no-show / cancellation rate with a per-channel breakdown. Prefer this over prose when the operator asks 'show covers this week', 'what's our no-show rate this month?' or wants the numbers to look at. Resolve relative phrases like 'last 7 days'/'this month' to absolute YYYY-MM-DD dates first. This only DISPLAYS — it changes nothing.",
			parameters: {
				type: 'object',
				properties: {
					from: dateStr,
					to: dateStr,
					metric: {
						type: 'string',
						enum: ['covers', 'noshow'],
						description: "Which report to show: 'covers' (default) or 'noshow'."
					}
				},
				required: ['from', 'to']
			},
			run: async ({
				from,
				to,
				metric
			}: {
				from: string;
				to: string;
				metric?: 'covers' | 'noshow';
			}) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
					throw new Error("Dates must be 'YYYY-MM-DD'.");
				}
				const which = metric === 'noshow' ? 'noshow' : 'covers';
				if (which === 'noshow') {
					const report = await getNoShowReport(brand, from, to);
					return {
						kind: 'report',
						metric: 'noshow',
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
							label: c.label,
							resolved: c.resolved,
							noShows: c.noShows,
							noShowRatePct: Math.round(c.noShowRate * 100)
						}))
					};
				}
				const report = await getCoversReport(brand, from, to);
				return {
					kind: 'report',
					metric: 'covers',
					from: report.from,
					to: report.to,
					totals: report.totals,
					byDay: report.byDay.map((d) => ({
						date: d.date,
						bookings: d.bookings,
						covers: d.covers,
						cancelled: d.cancelled,
						noShows: d.noShows
					}))
				};
			}
		}
	];
}
