import { describe, it, expect } from 'vitest';
import {
	localParts,
	slotKey,
	bucketHistory,
	blendSeries,
	recommendedCap,
	forecastCell,
	buildPacingCurve,
	forecastForDate,
	dowOf,
	DEFAULT_FORECAST_CONFIG,
	type ForecastConfig,
	type PacingCurve,
	type CellHistory
} from './forecast.js';
import type { Booking, ServicePeriod } from '../db/types.js';

const TZ = 'Europe/London';

// --- fixtures ---------------------------------------------------------------

function booking(over: Partial<Booking> & { id: string; starts_at: string }): Booking {
	return {
		created: '',
		updated: '',
		restaurant: 'r1',
		customer: 'c1',
		party_size: 2,
		ends_at: over.starts_at,
		tables: [],
		service_period: 'dinner',
		status: 'completed',
		source: 'online',
		special_requests: '',
		occasion: '',
		...over
	};
}

function period(over: Partial<ServicePeriod> & { id: string; name: string }): ServicePeriod {
	return {
		created: '',
		updated: '',
		restaurant: 'r1',
		days_of_week: [0, 1, 2, 3, 4, 5, 6],
		start_time: '18:00',
		end_time: '22:00',
		last_booking_time: '21:00',
		default_turn_minutes: 120,
		active: true,
		...over
	};
}

const CFG: ForecastConfig = { ...DEFAULT_FORECAST_CONFIG, minOccurrences: 2 };

// --- local parts + slot snapping -------------------------------------------

describe('localParts', () => {
	it('extracts local date, dow and HH:mm in the restaurant timezone', () => {
		// 2026-06-12 is a Friday. 18:30 UTC in summer (BST) is 19:30 local.
		const p = localParts(new Date('2026-06-12T18:30:00.000Z'), TZ);
		expect(p.date).toBe('2026-06-12');
		expect(p.dow).toBe(5); // Friday
		expect(p.hhmm).toBe('19:30');
	});

	it('rolls the local date across midnight', () => {
		// 23:30 UTC summer = 00:30 BST next day.
		const p = localParts(new Date('2026-06-12T23:30:00.000Z'), TZ);
		expect(p.date).toBe('2026-06-13');
		expect(p.dow).toBe(6); // Saturday
	});

	it('is DST-correct across the autumn fall-back', () => {
		// Clocks fall back 2026-10-25 02:00 BST->01:00 GMT. 00:30 UTC on the 24th is
		// 01:30 BST of the 25th.
		const p = localParts(new Date('2026-10-24T23:30:00.000Z'), TZ);
		expect(p.date).toBe('2026-10-25');
	});
});

describe('slotKey', () => {
	it('snaps to the start of the containing slot', () => {
		expect(slotKey('19:07', 15)).toBe('19:00');
		expect(slotKey('19:15', 15)).toBe('19:15');
		expect(slotKey('19:29', 15)).toBe('19:15');
		expect(slotKey('19:30', 30)).toBe('19:30');
		expect(slotKey('19:59', 30)).toBe('19:30');
	});
});

describe('dowOf', () => {
	it('returns 0=Sun..6=Sat', () => {
		expect(dowOf('2026-06-14')).toBe(0); // Sunday
		expect(dowOf('2026-06-12')).toBe(5); // Friday
	});
});

// --- history bucketing ------------------------------------------------------

describe('bucketHistory', () => {
	it('groups realised covers by (dow, period) per occurrence date', () => {
		const cells = bucketHistory(
			[
				// two Fridays, dinner
				booking({ id: 'a', starts_at: '2026-06-05T18:00:00.000Z', party_size: 2 }),
				booking({ id: 'b', starts_at: '2026-06-05T18:05:00.000Z', party_size: 4 }),
				booking({ id: 'c', starts_at: '2026-06-12T18:00:00.000Z', party_size: 3 })
			],
			TZ,
			15
		);
		const friDinner = cells.get('5:dinner');
		expect(friDinner).toBeDefined();
		// 2 occurrence dates (05, 12 June, both Fridays in local time)
		expect(friDinner!.periodCoversByDate.size).toBe(2);
		expect(friDinner!.periodCoversByDate.get('2026-06-05')).toBe(6);
		expect(friDinner!.periodCoversByDate.get('2026-06-12')).toBe(3);
		// both 19:0x local fall in the same 19:00 slot
		expect(friDinner!.slotCoversByDate.get('2026-06-05')!.get('19:00')).toBe(6);
	});

	it('excludes cancelled and no-show bookings', () => {
		const cells = bucketHistory(
			[
				booking({ id: 'a', starts_at: '2026-06-05T18:00:00.000Z', party_size: 4, status: 'cancelled' }),
				booking({ id: 'b', starts_at: '2026-06-05T18:00:00.000Z', party_size: 4, status: 'no_show' }),
				booking({ id: 'c', starts_at: '2026-06-05T18:00:00.000Z', party_size: 2, status: 'seated' })
			],
			TZ,
			15
		);
		expect(cells.get('5:dinner')!.periodCoversByDate.get('2026-06-05')).toBe(2);
	});

	it('ignores zero/negative party sizes and bad dates', () => {
		const cells = bucketHistory(
			[
				booking({ id: 'a', starts_at: '2026-06-05T18:00:00.000Z', party_size: 0 }),
				booking({ id: 'b', starts_at: 'not-a-date', party_size: 4 })
			],
			TZ,
			15
		);
		expect(cells.size).toBe(0);
	});
});

// --- blend / cap math -------------------------------------------------------

describe('blendSeries', () => {
	it('returns 0 for an empty series', () => {
		expect(blendSeries([], CFG)).toBe(0);
	});

	it('blends seasonal (recent) with overall mean per seasonalWeight', () => {
		const cfg: ForecastConfig = { ...CFG, seasonalWeeks: 2, seasonalWeight: 0.5 };
		// series oldest->newest. overall mean = (2+4+6+8)/4 = 5. recent 2 = (6+8)/2 = 7.
		// blend = 0.5*7 + 0.5*5 = 6.
		expect(blendSeries([2, 4, 6, 8], cfg)).toBe(6);
	});

	it('weights recent occurrences more when seasonalWeight is high', () => {
		const cfg: ForecastConfig = { ...CFG, seasonalWeeks: 1, seasonalWeight: 1 };
		// only the most recent occurrence matters.
		expect(blendSeries([2, 4, 100], cfg)).toBe(100);
	});
});

describe('recommendedCap', () => {
	it('applies headroom and ceils', () => {
		expect(recommendedCap(10, 1.15)).toBe(12); // ceil(11.5)
	});
	it('never drops below the absolute minimum cap', () => {
		expect(recommendedCap(0, 1.15)).toBe(1); // default minCap = 1
		expect(recommendedCap(0.2, 1.15, 4)).toBe(4); // explicit floor honoured
	});
});

// --- forecastCell -----------------------------------------------------------

describe('forecastCell', () => {
	function cell(): CellHistory {
		// Two Friday-dinner occurrences with one busy 19:00 slot.
		return {
			dow: 5,
			periodId: 'dinner',
			periodCoversByDate: new Map([
				['2026-06-05', 20],
				['2026-06-12', 30]
			]),
			slotCoversByDate: new Map([
				['2026-06-05', new Map([['19:00', 12], ['19:30', 8]])],
				['2026-06-12', new Map([['19:00', 18], ['19:30', 12]])]
			])
		};
	}

	it('produces blended expected covers + a headroom cap when there is enough history', () => {
		const f = forecastCell(cell(), 'Dinner', { ...CFG, headroom: 1.2 });
		expect(f.coldStart).toBe(false);
		expect(f.sampleSize).toBe(2);
		// period blend of [20,30] with default seasonalWeeks>=2 & weight 0.6:
		// overall=25, recent(both)=25 -> 25. cap = ceil(25*1.2)=30.
		expect(f.expectedCovers).toBe(25);
		expect(f.recommendedPeriodCap).toBe(30);
		// 19:00 slot blend of [12,18] = 15 -> cap ceil(18)=18.
		const s = f.slots.find((x) => x.slot === '19:00')!;
		expect(s.expectedCovers).toBe(15);
		expect(s.recommendedCap).toBe(18);
		// slots are sorted
		expect(f.slots.map((x) => x.slot)).toEqual(['19:00', '19:30']);
	});

	it('treats a slot absent on one occurrence as 0 covers that occurrence', () => {
		const c = cell();
		// 12 June had no 20:00 slot; 05 June had 10 covers at 20:00.
		c.slotCoversByDate.get('2026-06-05')!.set('20:00', 10);
		const f = forecastCell(c, 'Dinner', { ...CFG, seasonalWeight: 0.5, seasonalWeeks: 2 });
		const s = f.slots.find((x) => x.slot === '20:00')!;
		// series [10, 0] -> mean 5 (overall==recent) -> 5.
		expect(s.expectedCovers).toBe(5);
	});

	it('falls back to cold-start caps when below minOccurrences', () => {
		const c = cell();
		c.periodCoversByDate.delete('2026-06-12'); // leave one occurrence
		c.slotCoversByDate.delete('2026-06-12');
		const cfg: ForecastConfig = { ...CFG, minOccurrences: 3, coldStartPeriodCap: 99, coldStartSlotCap: 7 };
		const f = forecastCell(c, 'Dinner', cfg);
		expect(f.coldStart).toBe(true);
		expect(f.recommendedPeriodCap).toBe(99);
		expect(f.slots.every((s) => s.recommendedCap === 7 && s.coldStart)).toBe(true);
	});
});

// --- buildPacingCurve -------------------------------------------------------

describe('buildPacingCurve', () => {
	const periods = [period({ id: 'dinner', name: 'Dinner' }), period({ id: 'lunch', name: 'Lunch' })];

	it('assembles cells keyed by dow:period and stamps metadata', () => {
		const curve = buildPacingCurve({
			brand: 'asia',
			timezone: TZ,
			now: new Date('2026-06-25T03:00:00.000Z'),
			periods,
			bookings: [
				booking({ id: 'a', starts_at: '2026-06-05T18:00:00.000Z', party_size: 10 }),
				booking({ id: 'b', starts_at: '2026-06-12T18:00:00.000Z', party_size: 12 })
			],
			config: { minOccurrences: 2 }
		});
		expect(curve.brand).toBe('asia');
		expect(curve.generatedAt).toBe('2026-06-25T03:00:00.000Z');
		expect(curve.timezone).toBe(TZ);
		expect(Object.keys(curve.cells)).toEqual(['5:dinner']);
		const cell = curve.cells['5:dinner'];
		expect(cell.periodName).toBe('Dinner');
		expect(cell.coldStart).toBe(false);
		expect(cell.expectedCovers).toBe(11);
	});

	it('produces an empty cell map with no history', () => {
		const curve = buildPacingCurve({
			brand: 'fusion',
			timezone: TZ,
			now: new Date(),
			periods,
			bookings: []
		});
		expect(curve.cells).toEqual({});
	});
});

// --- forecastForDate (read side) -------------------------------------------

describe('forecastForDate', () => {
	const periods = [period({ id: 'dinner', name: 'Dinner', days_of_week: [5, 6] })];

	function curveWithFriday(): PacingCurve {
		return buildPacingCurve({
			brand: 'asia',
			timezone: TZ,
			now: new Date('2026-06-25T03:00:00.000Z'),
			periods,
			bookings: [
				booking({ id: 'a', starts_at: '2026-06-05T18:00:00.000Z', party_size: 10 }),
				booking({ id: 'b', starts_at: '2026-06-12T18:00:00.000Z', party_size: 12 })
			],
			config: { minOccurrences: 2 }
		});
	}

	it('returns matching cells for the date weekday', () => {
		// 2026-06-19 is a Friday.
		const f = forecastForDate('2026-06-19', curveWithFriday(), periods);
		expect(f.dow).toBe(5);
		expect(f.coldStart).toBe(false);
		expect(f.periods).toHaveLength(1);
		expect(f.periods[0].periodId).toBe('dinner');
		expect(f.generatedAt).toBe('2026-06-25T03:00:00.000Z');
	});

	it('synthesises conservative cold-start cells when the curve lacks that weekday', () => {
		// 2026-06-20 is a Saturday — the curve only has Friday history, but Saturday
		// is an active period day, so we get a cold-start cell.
		const f = forecastForDate('2026-06-20', curveWithFriday(), periods);
		expect(f.dow).toBe(6);
		expect(f.coldStart).toBe(true);
		expect(f.periods).toHaveLength(1);
		expect(f.periods[0].recommendedPeriodCap).toBe(DEFAULT_FORECAST_CONFIG.coldStartPeriodCap);
		expect(f.periods[0].sampleSize).toBe(0);
	});

	it('cold-starts entirely when the curve is null', () => {
		const f = forecastForDate('2026-06-19', null, periods);
		expect(f.coldStart).toBe(true);
		expect(f.generatedAt).toBeNull();
		expect(f.periods).toHaveLength(1); // Friday is an active day
	});

	it('rejects a malformed date', () => {
		expect(() => forecastForDate('19/06/2026', null, periods)).toThrow();
	});
});
