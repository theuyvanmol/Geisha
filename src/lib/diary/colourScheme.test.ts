import { describe, it, expect } from 'vitest';
import { barColour, channelColour, isLateNow, schemeLegend, SCHEMES } from './colourScheme';
import type { ColourableBar } from './colourScheme';

const base: ColourableBar = {
	arrival: 'unarrived',
	channel: 'Online',
	partySize: 2,
	confirmed: false,
	hasPreorder: false,
	important: false,
	paymentStatus: 'none'
};

describe('barColour', () => {
	it('returns null for the arrival scheme (CSS owns that palette)', () => {
		expect(barColour('arrival', base)).toBeNull();
	});

	it('confirmation: two distinct bands', () => {
		expect(barColour('confirmation', { ...base, confirmed: true })?.label).toBe('Confirmed');
		expect(barColour('confirmation', { ...base, confirmed: false })?.label).toBe('Unconfirmed');
	});

	it('preorder: complete vs none', () => {
		expect(barColour('preorder', { ...base, hasPreorder: true })?.label).toBe('Completed');
		expect(barColour('preorder', { ...base, hasPreorder: false })?.label).toBe('Incomplete');
	});

	it('payment: paid / outstanding / none map to distinct bands', () => {
		expect(barColour('payment', { ...base, paymentStatus: 'paid' })?.label).toBe('Fully paid');
		expect(barColour('payment', { ...base, paymentStatus: 'outstanding' })?.label).toBe(
			'Outstanding'
		);
		expect(barColour('payment', { ...base, paymentStatus: 'none' })?.label).toBe('No payment');
	});

	it('channel: maps known channels, falls back to Other', () => {
		expect(barColour('channel', { ...base, channel: 'Online' })?.label).toBe('Online');
		expect(barColour('channel', { ...base, channel: 'Internal' })?.label).toBe('Internal');
		// every staff-entered channel — walk-in, phone, assistant — is one blue band
		expect(barColour('channel', { ...base, channel: 'Walk-in' })?.label).toBe('Internal');
		expect(barColour('channel', { ...base, channel: 'ResPhone' })?.label).toBe('Internal');
		expect(barColour('channel', { ...base, channel: 'Skip-the-dishes' })?.label).toBe('Other');
	});

	it('channelColour: yellow = the guest booked it, blue = staff booked it', () => {
		const blue = '#93c7fa';
		expect(channelColour('Online').bar).toBe('#ffeb66');
		expect(channelColour('Internal').bar).toBe(blue);
		expect(channelColour('Walk-in').bar).toBe(blue);
		expect(channelColour('Phone').bar).toBe(blue);
		expect(channelColour('').label).toBe('Other');
	});

	it('important: has-notes vs none', () => {
		expect(barColour('important', { ...base, important: true })?.label).toBe('Has notes');
		expect(barColour('important', { ...base, important: false })?.label).toBe('No notes');
	});

	it('large_party: respects the threshold (boundary inclusive)', () => {
		expect(barColour('large_party', { ...base, partySize: 7 }, 8)?.label).toBe('Standard');
		expect(barColour('large_party', { ...base, partySize: 8 }, 8)?.label).toBe('Large (8+)');
		expect(barColour('large_party', { ...base, partySize: 12 }, 8)?.label).toBe('Large (8+)');
		// a custom threshold flows through to the label
		expect(barColour('large_party', { ...base, partySize: 6 }, 6)?.label).toBe('Large (6+)');
	});

	it('every non-arrival scheme returns a fill + ink colour', () => {
		for (const s of SCHEMES) {
			if (s === 'arrival') continue;
			const c = barColour(s, base);
			expect(c).not.toBeNull();
			expect(c?.bar).toMatch(/^#|rgb/);
			expect(c?.ink).toMatch(/^#|rgb/);
		}
	});
});

// These are QUOTED from ResDiary's View Management dialog (the `behaviours-color`
// swatches), not eyeballed from a screenshot. They were wrong once already — matched
// against ResDiary's Bootstrap-3 chrome, which has nothing to do with the status key
// — so they are pinned here. A failure means someone changed a status colour: check
// it against the real dialog before updating the expectation.
describe('ResDiary exact status colours', () => {
	const RD = {
		cyan: '#77d9ff', // Unarrived / Unconfirmed / No payments / Normal / Standard
		green: '#88d435', // Arrived / Fully paid / Important
		amber: '#ffad00', // Confirmed / Waiting in bar
		pink: '#ff6682', // Late / Outstanding
		yellow: '#ffeb66', // Partially seated / Online channel
		internal: '#93c7fa'
	};

	it('confirmation: Confirmed is AMBER and Unconfirmed is CYAN (not green/yellow)', () => {
		expect(barColour('confirmation', { ...base, confirmed: true })?.bar).toBe(RD.amber);
		expect(barColour('confirmation', { ...base, confirmed: false })?.bar).toBe(RD.cyan);
	});

	it('payment: cyan / pink / green', () => {
		expect(barColour('payment', { ...base, paymentStatus: 'none' })?.bar).toBe(RD.cyan);
		expect(barColour('payment', { ...base, paymentStatus: 'outstanding' })?.bar).toBe(RD.pink);
		expect(barColour('payment', { ...base, paymentStatus: 'paid' })?.bar).toBe(RD.green);
	});

	it('important: Normal is cyan, Important is green', () => {
		expect(barColour('important', { ...base, important: false })?.bar).toBe(RD.cyan);
		expect(barColour('important', { ...base, important: true })?.bar).toBe(RD.green);
	});

	it('channels: Online yellow, Internal blue', () => {
		expect(channelColour('Online').bar).toBe(RD.yellow);
		expect(channelColour('Internal').bar).toBe(RD.internal);
	});

	it('every "nothing set yet" band is the same cyan across schemes', () => {
		const nothing = [
			barColour('confirmation', { ...base, confirmed: false }),
			barColour('payment', { ...base, paymentStatus: 'none' }),
			barColour('preorder', { ...base, hasPreorder: false }),
			barColour('important', { ...base, important: false }),
			barColour('large_party', { ...base, partySize: 2 }, 8)
		];
		for (const b of nothing) expect(b?.bar).toBe(RD.cyan);
	});

	it('service status never paints a merely-unarrived booking as a problem', () => {
		// the whole point of the scheme: only a real no-show goes pink
		expect(barColour('service', { ...base, arrival: 'unarrived' })?.bar).toBe(RD.cyan);
		expect(barColour('service', { ...base, arrival: 'late' })?.bar).toBe(RD.cyan);
		expect(barColour('service', { ...base, arrival: 'no_show' })?.bar).toBe(RD.pink);
	});
});

describe('schemeLegend', () => {
	it('arrival has no dynamic legend (uses the static strip)', () => {
		expect(schemeLegend('arrival')).toEqual([]);
	});
	it('each other scheme yields at least two bands', () => {
		for (const s of SCHEMES) {
			if (s === 'arrival') continue;
			expect(schemeLegend(s).length).toBeGreaterThanOrEqual(2);
		}
	});
	it('large_party legend reflects the threshold', () => {
		expect(schemeLegend('large_party', 10).some((b) => b.label.includes('10+'))).toBe(true);
	});
});

describe('isLateNow — "booked at 7pm and not here" (owner request)', () => {
	// A 19:00 booking on a live day. Times as instants so the rule is timezone-proof.
	const SEVEN_PM = Date.parse('2026-07-31T19:00:00+01:00');
	const bar = (arrival: string) => ({ arrival, startsAt: new Date(SEVEN_PM).toISOString() });

	it('is NOT late one second BEFORE its time', () => {
		expect(isLateNow(bar('unarrived'), SEVEN_PM - 1000, true)).toBe(false);
	});

	it('is NOT late exactly ON its time', () => {
		expect(isLateNow(bar('unarrived'), SEVEN_PM, true)).toBe(false);
	});

	it('IS late one second after — no grace period', () => {
		expect(isLateNow(bar('unarrived'), SEVEN_PM + 1000, true)).toBe(true);
		// ...and well inside the ten minutes the server used to wait out.
		expect(isLateNow(bar('unarrived'), SEVEN_PM + 60_000, true)).toBe(true);
	});

	it('treats the server\u2019s own "late" the same way', () => {
		expect(isLateNow(bar('late'), SEVEN_PM + 1000, true)).toBe(true);
	});

	it('never fires for a guest who is HERE, however late they were', () => {
		for (const here of ['arrived', 'partially_seated', 'waiting_bar', 'table_ready']) {
			expect(isLateNow(bar(here), SEVEN_PM + 3_600_000, true)).toBe(false);
		}
	});

	it('never fires for a settled booking (left / no-show)', () => {
		for (const done of ['left', 'no_show']) {
			expect(isLateNow(bar(done), SEVEN_PM + 3_600_000, true)).toBe(false);
		}
	});

	it('never fires on a day that is not live — no wall of red on a past date', () => {
		expect(isLateNow(bar('unarrived'), SEVEN_PM + 86_400_000, false)).toBe(false);
	});

	it('ignores an unparseable start rather than painting it red', () => {
		expect(isLateNow({ arrival: 'unarrived', startsAt: 'not-a-date' }, SEVEN_PM, true)).toBe(false);
	});
});
