import { describe, it, expect } from 'vitest';
import {
	median,
	scaledMad,
	baselineOf,
	detectMetric,
	detectAnomalies,
	DEFAULT_ANOMALY_CONFIG,
	type AnomalyConfig,
	type MetricSeries
} from './anomaly.js';

const cfg: AnomalyConfig = DEFAULT_ANOMALY_CONFIG;

describe('median', () => {
	it('handles odd and even lengths', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 2, 3])).toBe(2.5);
	});
	it('returns 0 for empty', () => {
		expect(median([])).toBe(0);
	});
});

describe('scaledMad', () => {
	it('is zero for a flat series', () => {
		expect(scaledMad([5, 5, 5, 5], 5)).toBe(0);
	});
	it('scales the median absolute deviation by 1.4826', () => {
		// deviations from median 5 are [0,0,2,2] -> MAD = 1 -> scaled ≈ 1.4826
		const v = [3, 5, 5, 7];
		expect(scaledMad(v, median(v))).toBeCloseTo(1.4826, 3);
	});
});

describe('baselineOf', () => {
	it('reports median, spread and sample count', () => {
		const b = baselineOf([4, 5, 6, 5, 5]);
		expect(b.median).toBe(5);
		expect(b.samples).toBe(5);
		expect(b.spread).toBeGreaterThanOrEqual(0);
	});
});

describe('detectMetric — cold start', () => {
	it('stays silent below minSamples', () => {
		const hist = [5, 5, 5]; // fewer than minSamples (7)
		expect(detectMetric('cancellations', 50, hist, cfg)).toBeNull();
	});
});

describe('detectMetric — spike detection', () => {
	const baseline = [2, 3, 2, 3, 2, 3, 2, 3, 2, 3]; // 10 days, median ~2.5, small spread

	it('flags a clear spike in cancellations as an anomaly', () => {
		const hit = detectMetric('cancellations', 20, baseline, cfg);
		expect(hit).not.toBeNull();
		expect(hit!.metric).toBe('cancellations');
		expect(hit!.direction).toBe('spike');
		expect(hit!.value).toBe(20);
		expect(['warning', 'critical']).toContain(hit!.severity);
		expect(hit!.summary).toContain('Cancellations');
	});

	it('does not flag a value within the absolute-deviation floor', () => {
		// median ~2.5; a value of 4 is only ~1.5 away, below minAbsDeviation (3)
		expect(detectMetric('cancellations', 4, baseline, cfg)).toBeNull();
	});

	it('escalates to critical for an extreme spike', () => {
		const hit = detectMetric('no_shows', 40, baseline, cfg);
		expect(hit).not.toBeNull();
		expect(hit!.severity).toBe('critical');
	});
});

describe('detectMetric — direction filtering', () => {
	const baseline = Array(14).fill(20); // flat at 20, well-sampled

	it('ignores a DROP in cancellations (spike-only metric)', () => {
		// spread is 0 (flat) but a drop should still be ignored for cancellations
		expect(detectMetric('cancellations', 0, baseline, cfg)).toBeNull();
	});

	it('DOES flag a collapse in new bookings (watched both ways)', () => {
		const hit = detectMetric('bookings', 0, baseline, cfg);
		expect(hit).not.toBeNull();
		expect(hit!.direction).toBe('drop');
		// flat window => spread 0 => z is Infinity but abs floor cleared
		expect(Number.isFinite(hit!.z)).toBe(false);
	});
});

describe('detectAnomalies — ordering + multi-metric', () => {
	it('returns most-severe first and skips quiet metrics', () => {
		const series: MetricSeries[] = [
			{ metric: 'bookings', value: 21, history: [20, 20, 20, 20, 20, 20, 20, 20] }, // +1, immaterial
			{
				metric: 'cancellations',
				value: 30,
				history: [3, 2, 3, 2, 3, 2, 3, 2, 3, 2] // big spike
			},
			{
				metric: 'no_shows',
				value: 12,
				history: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] // moderate spike
			}
		];
		const out = detectAnomalies(series, cfg);
		// bookings +1 is immaterial -> not flagged; the other two are
		expect(out.map((a) => a.metric)).not.toContain('bookings');
		expect(out.length).toBe(2);
		// most-severe / largest-z first
		const rank = { critical: 2, warning: 1, info: 0 } as const;
		expect(rank[out[0].severity]).toBeGreaterThanOrEqual(rank[out[1].severity]);
	});
});
