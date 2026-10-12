// Operational-alerts read helper (mf-anomaly-alerts).
//
// The anomaly cron (api/cron/anomaly) WRITES geisha_alerts; this is the read side
// the admin dashboard banner consumes. Kept tiny and server-only. Degrades to an
// empty list if the collection isn't present yet (pre-migration) so the dashboard
// never hard-fails on a fresh environment.

import { pb } from '../db/pb.js';
import type { Alert, BrandId } from '../db/types.js';
import { getRestaurant } from './queries.js';
import { writeAudit } from './audit.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** Cap on how many open alerts the banner loads (newest first). */
const MAX_ALERTS = 20;

/**
 * Open (unacknowledged) alerts for a brand, newest first. Returns [] on any
 * failure (brand not provisioned, collection absent, query error) — the banner is
 * additive and must never break the dashboard.
 */
export async function getOpenAlerts(brand: BrandId): Promise<Alert[]> {
	let restaurantId: string;
	try {
		restaurantId = (await getRestaurant(brand)).id;
	} catch {
		return [];
	}
	try {
		const c = await pb();
		return await c.collection('geisha_alerts').getFullList<Alert>({
			filter: `restaurant=${q(restaurantId)} && acknowledged=false`,
			sort: '-created'
		}).then((rows) => rows.slice(0, MAX_ALERTS));
	} catch {
		return [];
	}
}

/**
 * Acknowledge (dismiss) an alert so it stops surfacing on the banner. Best-effort,
 * audited as a staff action. Returns true on success, false on any failure.
 */
export async function acknowledgeAlert(id: string): Promise<boolean> {
	try {
		const c = await pb();
		await c.collection('geisha_alerts').update(id, { acknowledged: true });
		await writeAudit('staff', 'alert_acknowledged', 'geisha_alerts', id, null, {
			acknowledged: true
		});
		return true;
	} catch (err) {
		console.error('[alerts] failed to acknowledge alert', id, err);
		return false;
	}
}
