// Closures-domain tools for the admin assistant: list the blackout / private-hire
// calendar and add or remove entries. A closure blocks bookings for a date (or a
// date range), either for the WHOLE day or just one service period. All wrap the
// SAME server functions the /admin/closures page uses, so the AI never invents a
// closure and every write audits with the ctx actor.
//
// Registered in the composer (./index.ts) — adding a tool here is the only change.

import {
	listClosures,
	createClosure,
	deleteClosure,
	listPeriods
} from '$lib/server/booking/admin.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

/** Closures-domain tools for a brand. */
export function closureTools(ctx: ToolContext): GeminiTool[] {
	const { brand, actor, onBehalfOf: ctxOnBehalfOf } = ctx;

	return [
		// --- READ ---------------------------------------------------------------
		{
			name: 'list_closures',
			kind: 'read',
			description:
				"The venue's CLOSURES — dates (or ranges) where bookings are blocked, for the whole day or one service period: holidays, private hire, maintenance. Each entry: id, date range, scope (full day / a period), kind and reason. Use before answering 'are we closed on X?' or 'is the 25th blocked?', and to get a closure id to remove.",
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const [closures, periods] = await Promise.all([listClosures(brand), listPeriods(brand)]);
				const periodName = new Map(periods.map((p) => [p.id, p.name]));
				return closures.map((c) => ({
					id: c.id,
					from: c.date_from,
					to: c.date_to,
					scope: c.scope,
					period:
						c.scope === 'period' && c.service_period
							? periodName.get(c.service_period) ?? c.service_period
							: undefined,
					kind: c.kind,
					reason: c.reason || undefined
				}));
			}
		},

		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'create_closure',
			kind: 'write',
			description:
				"Block bookings for a date or date range — a holiday, private hire or maintenance day. Scope 'full' blocks the whole day; scope 'period' blocks just one service (give the period name). Blocks ALL sources including staff, so check before closing a busy day. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					dateFrom: { ...dateStr, description: "First closed date, 'YYYY-MM-DD'." },
					dateTo: { ...dateStr, description: "Last closed date (inclusive), 'YYYY-MM-DD'. Omit for a single day." },
					scope: { type: 'string', enum: ['full', 'period'], description: "'full' = whole day, 'period' = one service." },
					period: { type: 'string', description: "Service period NAME (e.g. 'Dinner') — required when scope is 'period'." },
					kind: { type: 'string', enum: ['holiday', 'private_hire', 'maintenance'], description: 'Why it is closed.' },
					reason: { type: 'string', description: 'Optional free-text note shown to staff.' }
				},
				required: ['dateFrom', 'scope']
			},
			run: async (
				args: {
					dateFrom: string;
					dateTo?: string;
					scope: 'full' | 'period';
					period?: string;
					kind?: string;
					reason?: string;
				},
				onBehalfOf?: string
			) => {
				// Resolve a period NAME → id when the closure is period-scoped (the model
				// naturally says "close Dinner", not the id).
				let servicePeriodId: string | undefined;
				if (args.scope === 'period') {
					const periods = await listPeriods(brand);
					const match = periods.find(
						(p) => p.name.toLowerCase() === (args.period ?? '').trim().toLowerCase()
					);
					if (!match) return { ok: false, error: `No service period named "${args.period}".` };
					servicePeriodId = match.id;
				}
				try {
					const row = await createClosure(
						brand,
						{
							date_from: args.dateFrom,
							date_to: args.dateTo,
							scope: args.scope,
							service_period: servicePeriodId,
							kind: args.kind,
							reason: args.reason
						},
						actor,
						onBehalfOf ?? ctxOnBehalfOf
					);
					return { ok: true, id: row.id, from: row.date_from, to: row.date_to, scope: row.scope };
				} catch (e) {
					return { ok: false, error: e instanceof Error ? e.message : 'Could not create the closure.' };
				}
			}
		},
		{
			name: 'delete_closure',
			kind: 'write',
			description:
				'Remove a closure so the date/period accepts bookings again. Get the id from list_closures. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'The closure id from list_closures.' } },
				required: ['id']
			},
			run: async ({ id }: { id: string }, onBehalfOf?: string) => {
				await deleteClosure(id, actor, onBehalfOf ?? ctxOnBehalfOf);
				return { ok: true, id, removed: true };
			}
		}
	];
}
