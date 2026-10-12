// Customer-domain tools for the admin assistant. WP-S6-4 ports the two genuinely
// unique CRM read tools from the retired Claude stack: search_customers (find a
// guest by name/email/phone) and get_customer_history (their past bookings). Both
// wrap the SAME server functions the /admin/customers page uses — the AI never
// invents data. Registered in the composer (./index.ts) — adding a tool here is
// the only change needed.

import { listCustomers, getCustomerHistory } from '$lib/server/booking/admin.js';
import {
	getCustomerProfile,
	updateCustomerProfile,
	arrayToDietary,
	stripHtml
} from '$lib/server/booking/crm.js';
import type { GeminiTool, ToolContext } from './types.js';

/** Customer-domain tools for a brand. */
export function customerTools(ctx: ToolContext): GeminiTool[] {
	const { brand, actor, onBehalfOf: ctxOnBehalfOf } = ctx;
	return [
		{
			name: 'search_customers',
			kind: 'read',
			description:
				'Find guests by a partial name, email or phone. Returns matching customer records (id, name, contact, VIP/tags and visit counters). Use the returned id with get_customer_history to look up a guest before answering questions about them.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Part of the guest name, email or phone to search for.'
					}
				},
				required: ['query']
			},
			run: async ({ query }: { query: string }) => {
				const customers = await listCustomers(query);
				return customers.map((cu) => ({
					id: cu.id,
					name: cu.name,
					email: cu.email,
					phone: cu.phone,
					vip: cu.vip ?? false,
					tags: cu.tags ?? [],
					noShowCount: cu.no_show_count ?? 0,
					cancelCount: cu.cancel_count ?? 0
				}));
			}
		},
		{
			name: 'get_customer_history',
			kind: 'read',
			description:
				'Get the booking history for a customer id (most recent first): each booking with its date/time, party size and status. Use this to spot regulars, recent no-shows or a guest who has not visited lately. Get the id from search_customers first.',
			parameters: {
				type: 'object',
				properties: {
					customerId: {
						type: 'string',
						description: 'The customer id, as returned by search_customers.'
					}
				},
				required: ['customerId']
			},
			run: async ({ customerId }: { customerId: string }) => {
				const bookings = await getCustomerHistory(customerId);
				return bookings.map((b) => ({
					id: b.id,
					startsAt: b.starts_at,
					endsAt: b.ends_at,
					partySize: b.party_size,
					status: b.status,
					source: b.source
				}));
			}
		},
		{
			name: 'get_customer_profile',
			kind: 'read',
			description:
				"A guest's full profile: lifetime stats, no-show/cancel risk level, VIP flag, tags, structured dietary preferences, ALLERGIES (safety-critical), and their most recent bookings. Use this to answer 'tell me about this guest' and to flag allergies or VIP status before service. Pass the customerId from search_customers. Soft-deleted (erased) guests are never returned.",
			parameters: {
				type: 'object',
				properties: {
					customerId: {
						type: 'string',
						description: 'The customer id, as returned by search_customers.'
					}
				},
				required: ['customerId']
			},
			run: async ({ customerId }: { customerId: string }) => {
				const profile = await getCustomerProfile(brand, customerId);
				const cu = profile.customer;
				return {
					id: cu.id,
					name: cu.name,
					email: cu.email,
					phone: cu.phone,
					vip: cu.vip ?? false,
					tags: cu.tags ?? [],
					allergies: cu.allergies ?? '',
					dietary: arrayToDietary(cu.dietary),
					// HTML stripped so the model gets plain text, never markup.
					notes: stripHtml(cu.notes),
					stats: profile.stats,
					risk: profile.risk,
					recentBookings: profile.bookings.slice(0, 10).map((b) => ({
						id: b.id,
						startsAt: b.starts_at,
						partySize: b.party_size,
						status: b.status,
						occasion: b.occasion
					}))
				};
			}
		},

		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'set_customer_vip',
			kind: 'write',
			description:
				'Mark a guest as VIP (or clear the VIP flag). VIP guests are highlighted across the diary and run-sheet. Get the id from search_customers first. WRITE action — must be confirmed before it runs.',
			parameters: {
				type: 'object',
				properties: {
					customerId: { type: 'string', description: 'The customer id from search_customers.' },
					vip: { type: 'boolean', description: 'true to mark VIP, false to clear it.' }
				},
				required: ['customerId', 'vip']
			},
			run: async ({ customerId, vip }: { customerId: string; vip: boolean }, onBehalfOf?: string) => {
				const cu = await updateCustomerProfile(
					brand,
					customerId,
					{ vip },
					actor,
					onBehalfOf ?? ctxOnBehalfOf
				);
				return { ok: true, id: cu.id, name: cu.name, vip: cu.vip ?? false };
			}
		},
		{
			name: 'tag_customer',
			kind: 'write',
			description:
				"Set a guest's CRM tags (e.g. 'regular', 'press', 'allergy-aware', 'birthday'). This REPLACES the whole tag list with the one you pass — read the current tags from get_customer_profile first and include the ones to keep. Get the id from search_customers. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					customerId: { type: 'string', description: 'The customer id from search_customers.' },
					tags: {
						type: 'array',
						items: { type: 'string' },
						description: 'The full new tag list (replaces existing tags).'
					}
				},
				required: ['customerId', 'tags']
			},
			run: async ({ customerId, tags }: { customerId: string; tags: string[] }, onBehalfOf?: string) => {
				const cu = await updateCustomerProfile(
					brand,
					customerId,
					{ tags },
					actor,
					onBehalfOf ?? ctxOnBehalfOf
				);
				return { ok: true, id: cu.id, name: cu.name, tags: cu.tags ?? [] };
			}
		},
		{
			name: 'set_customer_allergies',
			kind: 'write',
			description:
				"Set or update a guest's ALLERGIES free-text note (safety-critical — shows loudly on the run-sheet and live floor). Pass the full allergy text (it replaces the existing note). Get the id from search_customers. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					customerId: { type: 'string', description: 'The customer id from search_customers.' },
					allergies: { type: 'string', description: "The allergy note, e.g. 'Severe nut allergy; coeliac'." }
				},
				required: ['customerId', 'allergies']
			},
			run: async (
				{ customerId, allergies }: { customerId: string; allergies: string },
				onBehalfOf?: string
			) => {
				const cu = await updateCustomerProfile(
					brand,
					customerId,
					{ allergies },
					actor,
					onBehalfOf ?? ctxOnBehalfOf
				);
				return { ok: true, id: cu.id, name: cu.name, allergies: cu.allergies ?? '' };
			}
		},
		{
			name: 'update_customer_notes',
			kind: 'write',
			description:
				"Set the free-text CRM notes on a guest's profile (preferences, history, anything staff should know). This REPLACES the existing notes — read them from get_customer_profile first if you want to append. Get the id from search_customers. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					customerId: { type: 'string', description: 'The customer id from search_customers.' },
					notes: { type: 'string', description: 'The full new notes text (replaces existing).' }
				},
				required: ['customerId', 'notes']
			},
			run: async ({ customerId, notes }: { customerId: string; notes: string }, onBehalfOf?: string) => {
				const cu = await updateCustomerProfile(
					brand,
					customerId,
					{ notes },
					actor,
					onBehalfOf ?? ctxOnBehalfOf
				);
				return { ok: true, id: cu.id, name: cu.name };
			}
		}
	];
}
