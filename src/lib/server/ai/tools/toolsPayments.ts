// Payments-domain tools for the admin assistant (WP-S6-6). One READ to inspect a
// booking's deposit / no-show-hold payment, and two confirm-gated WRITES that
// wrap the SAME server functions the booking detail page uses
// (refundDepositManual / releaseHoldManual) — so the AI never moves money on its
// own and every action audits with the ctx actor on behalf of the confirming
// staff member (threaded as run()'s second arg by confirmTool).
//
// refund_deposit is HIGH-BLAST-RADIUS: it is tagged with DESTRUCTIVE_PREFIX so
// the confirm UI requires a typed confirmation before it can be applied.
// Registered in the composer (./index.ts) — adding a tool here is the only change.

import { refundDepositManual, releaseHoldManual } from '$lib/server/booking/payments.js';
import type { GeminiTool, ToolContext } from './types.js';
import { DESTRUCTIVE_PREFIX } from './types.js';

/** Payments-domain tools for a brand. */
export function paymentTools(ctx: ToolContext): GeminiTool[] {
	const { actor, onBehalfOf } = ctx;
	// Confirm-gated writes thread the confirming staff id as run()'s second arg
	// (see geminiAgent.confirmTool); fall back to the ctx default otherwise.
	const obo = (confirmer?: string) => confirmer ?? onBehalfOf;

	return [
		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'refund_deposit',
			kind: 'write',
			description:
				`${DESTRUCTIVE_PREFIX} Refund a captured deposit back to the guest's card via Stripe — all of it, or a specific amount in pence. HIGH-IMPACT, irreversible WRITE — must be confirmed before it runs. Only a captured deposit can be refunded; nothing happens if there is no payment, Stripe isn't configured, or the payment isn't captured.`,
			parameters: {
				type: 'object',
				properties: {
					bookingId: {
						type: 'string',
						description: 'The booking whose deposit to refund (id from get_bookings_for_day).'
					},
					amountPence: {
						type: 'integer',
						description:
							'Amount to refund in pence. Omit (or 0) to refund the full captured amount.'
					},
					reason: { type: 'string', description: 'Why the deposit is being refunded (audited).' }
				},
				required: ['bookingId', 'reason']
			},
			run: (
				{
					bookingId,
					amountPence,
					reason
				}: { bookingId: string; amountPence?: number; reason: string },
				confirmer?: string
			) =>
				refundDepositManual(
					bookingId,
					amountPence && amountPence > 0 ? amountPence : 'full',
					reason,
					actor,
					obo(confirmer)
				)
		},
		{
			name: 'release_hold',
			kind: 'write',
			description:
				"Release (void) a no-show authorisation hold without charging the guest — e.g. to waive a no-show fee. Only an Authorized no-show hold can be released; nothing happens otherwise. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					bookingId: {
						type: 'string',
						description: 'The booking whose no-show hold to release (id from get_bookings_for_day).'
					},
					reason: { type: 'string', description: 'Why the hold is being released (audited).' }
				},
				required: ['bookingId', 'reason']
			},
			run: ({ bookingId, reason }: { bookingId: string; reason: string }, confirmer?: string) =>
				releaseHoldManual(bookingId, reason, actor, obo(confirmer))
		}
	];
}
