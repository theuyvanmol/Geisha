// Audit trail — every write to a booking/payment/table/setting goes through
// here so the geisha_audit_log records who did what (staff / ai / system /
// customer), with before/after snapshots. Essential once the AI can mutate data
// (BOOKING_SYSTEM_PLAN.md §9, §11). Best-effort: a logging failure never blocks
// the underlying operation.

import { pb } from '../db/pb.js';
import type { AuditActor } from '../db/types.js';

export async function writeAudit(
	actor: AuditActor,
	action: string,
	entity: string,
	entityId: string,
	before: unknown,
	after: unknown,
	/**
	 * The staff member an `ai`/`system` action was performed on behalf of (their
	 * geisha_staff id). Recorded in geisha_audit_log.on_behalf_of so the trail
	 * can attribute automated writes to the human who authorised them (§9, §11).
	 * Optional + appended last to keep the call signature back-compat.
	 */
	onBehalfOf?: string
): Promise<void> {
	try {
		const c = await pb();
		await c.collection('geisha_audit_log').create({
			actor,
			action,
			entity,
			entity_id: entityId,
			before: before ?? null,
			after: after ?? null,
			on_behalf_of: onBehalfOf ?? ''
		});
	} catch (err) {
		console.error('[audit] failed to write audit log:', err);
	}
}
