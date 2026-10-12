// Shared closure model + guard (Floor ↔ Diary parity, ResDiary "Service Closures").
//
// The loader shape both service views receive for the viewed date. A FULL-scope
// closure closes the whole day; a PERIOD-scope one closes a single service (the rest
// of the day stays bookable). The pure helpers below decide the banner headline and
// whether a new-booking affordance should be blocked — the booking core is the
// server-side backstop; this is the up-front UX so staff see it before a 409.

export interface ServiceClosure {
	closedFull: boolean;
	fullReason: string;
	active: {
		id: string;
		scope: 'full' | 'period';
		periodId: string;
		reason: string;
		kind: string;
	}[];
	periods: {
		id: string;
		name: string;
		start: string;
		end: string;
		lastBooking: string;
	}[];
}

export const CLOSURE_KIND_LABELS: Record<string, string> = {
	holiday: 'Holiday',
	private_hire: 'Private hire',
	maintenance: 'Maintenance'
};

const mins = (t: string) => {
	const [h, m] = t.split(':').map(Number);
	return h * 60 + (m || 0);
};

/** The name of a service period on this date, or a generic fallback. */
export function periodName(closure: ServiceClosure | null | undefined, id: string): string {
	return closure?.periods.find((p) => p.id === id)?.name || 'a service';
}

/** The bold headline for the red/amber banner (empty string when nothing is closed). */
export function closureBanner(closure: ServiceClosure | null | undefined): string {
	if (!closure) return '';
	if (closure.closedFull) {
		const r = (closure.fullReason ?? '').trim();
		return r ? `Closed all day — ${r}` : 'Closed all day';
	}
	const periodCs = closure.active.filter((c) => c.scope === 'period');
	if (periodCs.length) {
		const names = [...new Set(periodCs.map((c) => periodName(closure, c.periodId)))].join(', ');
		const r = periodCs.map((c) => c.reason).find((x) => x && x.trim());
		return `${names} closed${r ? ` — ${r}` : ''}`;
	}
	return '';
}

/** Which service period (by hours) a wall-clock 'HH:mm' falls into, or null. */
export function periodIdForTime(closure: ServiceClosure | null | undefined, time: string): string | null {
	if (!closure || !time) return null;
	const t = mins(time);
	for (const p of closure.periods) {
		const lo = mins(p.start);
		const hi = mins(p.lastBooking || p.end);
		if (t >= lo && t <= hi) return p.id;
	}
	return null;
}

/**
 * Decide whether a new-booking affordance is blocked by a closure, returning a
 * human reason (or null when open). A fully-closed day blocks everything; with a
 * `time`, a period-scope closure blocks only creates that land in the closed service.
 */
export function closureBlockReason(
	closure: ServiceClosure | null | undefined,
	time?: string
): string | null {
	if (!closure) return null;
	if (closure.closedFull) {
		return closureBanner(closure) || 'This day is closed for bookings.';
	}
	if (time) {
		const closedPeriodIds = new Set(
			closure.active.filter((c) => c.scope === 'period' && c.periodId).map((c) => c.periodId)
		);
		const pid = periodIdForTime(closure, time);
		if (pid && closedPeriodIds.has(pid)) {
			const c = closure.active.find((x) => x.scope === 'period' && x.periodId === pid);
			return `${periodName(closure, pid)} is closed${c?.reason ? ` — ${c.reason}` : ''}.`;
		}
	}
	return null;
}
