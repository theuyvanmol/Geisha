// Settings-domain tools for the admin assistant: read the current booking-policy
// settings, OPEN editable widgets beside the chat (a UI directive — no data
// change), and the confirm-gated write that sets an exact value. This module also
// owns the settings metadata the whole assistant shares — SETTING_META (friendly
// labels + value types so the UI can render a sensible widget), the SettingWidget
// shape, and settingsCatalogue() for the system prompt. Other streams that add a
// configurable key extend SETTING_META here (kept in sync with /admin/settings
// labels). It also carries the deposit/no-show rule tools and the PACING-rule
// tools: list (read) + create_pacing_rule / delete_pacing_rule (confirm-gated
// writes, audited via actor/onBehalfOf, mirroring the deposit-rule tools). All
// wrap the SAME server functions the admin UI uses.

import {
	listSettings,
	updateSetting,
	listDepositRules,
	createDepositRule,
	deleteDepositRule,
	listPacingRules,
	createPacingRule,
	deletePacingRule,
	listPeriods
} from '$lib/server/booking/admin.js';
import { getSetMenusForBrand } from '$lib/server/booking/setMenus.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dowLabel = (dow: number[]) =>
	!dow || dow.length === 0 ? 'every day' : dow.map((d) => DOW_NAMES[d] ?? d).join(', ');
const poundsLabel = (pence: number) => `£${(pence / 100).toFixed(2)}`;

// Friendly labels + value types for the known settings, so the UI can render a
// sensible widget. Kept in sync with admin/settings labels.
export const SETTING_META: Record<
	string,
	{ label: string; type: 'number' | 'text'; hint?: string }
> = {
	online_party_max: { label: 'Max party size online', type: 'number' },
	deposit_per_person_6plus_pence: {
		label: 'Deposit per person, 6+ (pence)',
		type: 'number',
		hint: '1000 = £10.00'
	},
	noshow_fee_per_person_fri_sat_pence: {
		label: 'No-show fee per person, Fri/Sat 3–5 (pence)',
		type: 'number',
		hint: '500 = £5.00'
	},
	unpaid_hold_minutes: { label: 'Cancel unpaid hold after (minutes)', type: 'number' },
	booking_window_days: { label: 'How far ahead guests can book (days)', type: 'number' },
	lead_time_minutes: {
		label: 'Online booking cut-off (minutes)',
		type: 'number',
		hint: '0 = no cut-off (the default). 120 closes online booking 2h out. Staff are never affected.'
	},
	lead_time_mode: {
		label: 'Cut-off counted back from',
		type: 'text',
		hint: '"visit" = the guest’s own time (rolling); "service" = the start of the service (the whole sitting closes at once)'
	},
	slot_interval_minutes: { label: 'Slot interval (minutes)', type: 'number' },
	ai_assistant_prompt: { label: 'Guest assistant prompt', type: 'text' }
};

export interface SettingWidget {
	id: string;
	key: string;
	label: string;
	type: 'number' | 'text';
	value: unknown;
	hint?: string;
}

/** A plain-text catalogue of the editable settings, for the system prompt so the
 *  model knows every key it can open and which task each maps to. */
export function settingsCatalogue(): string {
	return Object.entries(SETTING_META)
		.map(([key, m]) => `- ${key} — ${m.label}${m.hint ? ` (${m.hint})` : ''}`)
		.join('\n');
}

/** Settings-domain tools for a brand. */
export function settingTools(ctx: ToolContext): GeminiTool[] {
	const { brand, actor, onBehalfOf: ctxOnBehalfOf } = ctx;
	return [
		// --- READ ---------------------------------------------------------------
		{
			name: 'list_settings',
			kind: 'read',
			description:
				'List the current booking-policy settings (and their values) for this brand. Use before suggesting a settings change.',
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const settings = await listSettings(brand);
				return settings.map((s) => ({
					key: s.key,
					label: SETTING_META[s.key]?.label ?? s.key,
					value: s.value
				}));
			}
		},

		// --- UI (no data change) ------------------------------------------------
		{
			name: 'open_settings',
			kind: 'ui',
			description:
				'Open editable widgets for one or more settings beside the chat so the admin can change them directly. Pass the setting keys the admin needs. Use this whenever the admin wants to change a setting.',
			parameters: {
				type: 'object',
				properties: {
					keys: {
						type: 'array',
						items: { type: 'string' },
						description:
							'Setting keys to open, e.g. ["online_party_max","deposit_per_person_6plus_pence","ai_assistant_prompt"].'
					}
				},
				required: ['keys']
			},
			run: async ({ keys }: { keys: string[] }) => {
				const settings = await listSettings(brand);
				const byKey = new Map(settings.map((s) => [s.key, s]));
				const widgets: SettingWidget[] = [];
				const unknown: string[] = [];
				for (const key of keys) {
					const row = byKey.get(key);
					const meta = SETTING_META[key];
					if (!row) {
						unknown.push(key);
						continue;
					}
					widgets.push({
						id: row.id,
						key,
						label: meta?.label ?? key,
						type: meta?.type ?? 'text',
						value: row.value,
						hint: meta?.hint
					});
				}
				return { opened: widgets.map((w) => w.key), widgets, unknown };
			}
		},

		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'update_setting',
			kind: 'write',
			description:
				'Change a booking-policy setting to a new value, by setting key. Prefer open_settings so the admin can edit it themselves; use this only when the admin explicitly states the exact new value. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: 'The setting key, e.g. "online_party_max".'
					},
					value: { description: 'The new value (number for numeric settings, string otherwise).' }
				},
				required: ['key', 'value']
			},
			run: async ({ key, value }: { key: string; value: unknown }) => {
				const settings = await listSettings(brand);
				const row = settings.find((s) => s.key === key);
				if (!row) throw new Error(`Unknown setting: ${key}`);
				// coerce to the declared type so e.g. "10" becomes 10
				const coerced = SETTING_META[key]?.type === 'number' ? Number(value) : value;
				return updateSetting(row.id, coerced);
			}
		},

		// --- deposit / no-show rules (the priority-ordered policy engine) -------
		{
			name: 'list_deposit_rules',
			kind: 'read',
			description:
				"The deposit / no-show RULES — the priority-ordered policy that decides when a card or deposit is required (e.g. '£10pp deposit for 6+', '£5pp card hold Fri/Sat 3–5'). Each rule: id, priority (lower wins), party-size band, days, optional service/date range, kind (deposit = charged now, noshow_hold = card held only, none = no charge) and per-person amount. Read this before changing the deposit policy.",
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const [rules, periods] = await Promise.all([listDepositRules(brand), listPeriods(brand)]);
				const periodName = new Map(periods.map((p) => [p.id, p.name]));
				return rules.map((r) => ({
					id: r.id,
					priority: r.priority,
					partyMin: r.party_min,
					partyMax: r.party_max || undefined, // 0 = no upper bound
					days: dowLabel(r.dow),
					period: r.service_period ? periodName.get(r.service_period) ?? r.service_period : 'any',
					kind: r.kind || 'none',
					perPerson: r.kind && r.kind !== 'none' ? poundsLabel(r.per_person_pence) : undefined,
					capture: r.capture || undefined
				}));
			}
		},
		{
			name: 'create_deposit_rule',
			kind: 'write',
			description:
				"Add a deposit / no-show rule. kind: 'deposit' (charged up front, deducted from the bill), 'noshow_hold' (card details held, only charged on a no-show / late cancel), or 'none' (suppress any deposit for this band). partyMin/partyMax set the size band (partyMax 0 = no upper limit); days is an optional list of weekday numbers (0=Sun … 6=Sat, empty = every day). Lower priority wins when rules overlap. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					kind: { type: 'string', enum: ['deposit', 'noshow_hold', 'none'] },
					perPersonPence: { type: 'integer', description: 'Per-person amount in PENCE (e.g. 1000 = £10). Ignored for kind "none".' },
					partyMin: { type: 'integer', description: 'Smallest party this applies to (default 1).' },
					partyMax: { type: 'integer', description: 'Largest party (0 or omit = no upper limit).' },
					days: { type: 'array', items: { type: 'integer' }, description: 'Weekday numbers 0–6 (Sun–Sat). Omit for every day. Fri/Sat = [5,6].' },
					priority: { type: 'integer', description: 'Lower = higher precedence (e.g. 10). Default 0.' },
					capture: { type: 'string', enum: ['auto', 'manual'], description: "'auto' = charge now (deposit), 'manual' = hold only (no-show)." },
					dateFrom: { ...dateStr, description: 'Optional seasonal start, YYYY-MM-DD.' },
					dateTo: { ...dateStr, description: 'Optional seasonal end, YYYY-MM-DD.' }
				},
				required: ['kind']
			},
			run: async (
				args: {
					kind: 'deposit' | 'noshow_hold' | 'none';
					perPersonPence?: number;
					partyMin?: number;
					partyMax?: number;
					days?: number[];
					priority?: number;
					capture?: 'auto' | 'manual';
					dateFrom?: string;
					dateTo?: string;
				},
				onBehalfOf?: string
			) => {
				try {
					const row = await createDepositRule(
						brand,
						{
							kind: args.kind,
							per_person_pence: args.perPersonPence,
							party_min: args.partyMin,
							party_max: args.partyMax,
							dow: args.days,
							priority: args.priority,
							capture: args.capture,
							date_from: args.dateFrom,
							date_to: args.dateTo
						},
						actor,
						onBehalfOf ?? ctxOnBehalfOf
					);
					return { ok: true, id: row.id, kind: row.kind, perPerson: poundsLabel(row.per_person_pence) };
				} catch (e) {
					return { ok: false, error: e instanceof Error ? e.message : 'Could not create the rule.' };
				}
			}
		},
		{
			name: 'delete_deposit_rule',
			kind: 'write',
			description:
				'Remove a deposit / no-show rule. Get the id from list_deposit_rules. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'The rule id from list_deposit_rules.' } },
				required: ['id']
			},
			run: async ({ id }: { id: string }, onBehalfOf?: string) => {
				await deleteDepositRule(id, actor, onBehalfOf ?? ctxOnBehalfOf);
				return { ok: true, id, removed: true };
			}
		},

		// --- pacing rules (covers caps) — read only --------------------------
		{
			name: 'list_pacing_rules',
			kind: 'read',
			description:
				"The PACING rules (covers caps) that throttle how many covers can be booked per 15-min slot and per service period, plus any per-rule lead-time / booking-window overrides. Each: service period (or 'any'), days, max covers per slot, max covers per period. Use to explain why a slot shows full, or before adjusting how busy a service can get.",
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const [rules, periods] = await Promise.all([listPacingRules(brand), listPeriods(brand)]);
				const periodName = new Map(periods.map((p) => [p.id, p.name]));
				return rules.map((r) => ({
					id: r.id,
					period: r.service_period ? periodName.get(r.service_period) ?? r.service_period : 'any',
					days: dowLabel(r.dow),
					maxCoversPerSlot: r.max_covers_per_slot || undefined,
					maxCoversPerPeriod: r.max_covers_per_period || undefined,
					leadTimeMinutes: r.lead_time_minutes || undefined,
					bookingWindowDays: r.booking_window_days || undefined
				}));
			}
		},
		// --- pacing rules (covers caps) — writes (confirm-gated) --------------
		// --- set menus / pre-order catalogue — read only --------------------
		{
			name: 'list_set_menus',
			kind: 'read',
			description:
				"The bookable SET MENUS a guest can PRE-ORDER at booking time (ResDiary-style pre-order) — each with its name, price and course description. This is the pre-order catalogue offered in the booking widget, NOT the public marketing menu pages. Use to answer 'what set menus do we offer for pre-order?' or 'how much is the tasting menu'. Returns an empty list when none are configured. To CHANGE these, direct the operator to /admin/settings/menus-preorder.",
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const menus = await getSetMenusForBrand(brand);
				return {
					count: menus.length,
					setMenus: menus.map((m) => ({
						id: m.id,
						name: m.name,
						price: poundsLabel(m.pricePence),
						courses: m.courses
					}))
				};
			}
		},
		{
			name: 'create_pacing_rule',
			kind: 'write',
			description:
				"Add a PACING rule (a covers cap / throttle). Caps how many covers can be booked per 15-min slot (maxCoversPerSlot) and/or across a whole service period (maxCoversPerPeriod), and can override the lead time (minimum notice, minutes) and booking window (how far ahead guests can book, days) for the days it covers. period is an optional service-period id (omit = all services); days is an optional list of weekday numbers (0=Sun … 6=Sat, empty = every day; Fri/Sat = [5,6]). Use this to make a busy service quieter (e.g. cap Friday dinner at 20 covers per slot). WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					period: {
						type: 'string',
						description: 'Optional service-period id this rule applies to. Omit for all services.'
					},
					days: {
						type: 'array',
						items: { type: 'integer' },
						description: 'Weekday numbers 0–6 (Sun–Sat). Omit for every day. Fri/Sat = [5,6].'
					},
					maxCoversPerSlot: {
						type: 'integer',
						description: 'Cap on covers booked per 15-min slot (0 or omit = no per-slot cap).'
					},
					maxCoversPerPeriod: {
						type: 'integer',
						description: 'Cap on covers booked across the whole service (0 or omit = no cap).'
					},
					leadTimeMinutes: {
						type: 'integer',
						description: 'Override minimum notice before a slot, in minutes (0 or omit = default).'
					},
					bookingWindowDays: {
						type: 'integer',
						description: 'Override how far ahead guests can book, in days (0 or omit = default).'
					}
				}
			},
			run: async (
				args: {
					period?: string;
					days?: number[];
					maxCoversPerSlot?: number;
					maxCoversPerPeriod?: number;
					leadTimeMinutes?: number;
					bookingWindowDays?: number;
				},
				onBehalfOf?: string
			) => {
				try {
					const row = await createPacingRule(
						brand,
						{
							service_period: args.period,
							dow: args.days,
							max_covers_per_slot: args.maxCoversPerSlot,
							max_covers_per_period: args.maxCoversPerPeriod,
							lead_time_minutes: args.leadTimeMinutes,
							booking_window_days: args.bookingWindowDays
						},
						actor,
						onBehalfOf ?? ctxOnBehalfOf
					);
					return {
						ok: true,
						id: row.id,
						maxCoversPerSlot: row.max_covers_per_slot || undefined,
						maxCoversPerPeriod: row.max_covers_per_period || undefined
					};
				} catch (e) {
					return { ok: false, error: e instanceof Error ? e.message : 'Could not create the rule.' };
				}
			}
		},
		{
			name: 'delete_pacing_rule',
			kind: 'write',
			description:
				'Remove a PACING rule (covers cap). Get the id from list_pacing_rules. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: { id: { type: 'string', description: 'The rule id from list_pacing_rules.' } },
				required: ['id']
			},
			run: async ({ id }: { id: string }, onBehalfOf?: string) => {
				await deletePacingRule(id, actor, onBehalfOf ?? ctxOnBehalfOf);
				return { ok: true, id, removed: true };
			}
		}
	];
}
