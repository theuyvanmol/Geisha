import { describe, it, expect } from 'vitest';
import {
	partyBucket,
	estimateTurnMinutes,
	predictFree,
	MIN_SAMPLES,
	type TurnSample
} from './turns.js';
import type { ServicePeriod } from '../db/types.js';

const period = (turn: number): ServicePeriod =>
	({ default_turn_minutes: turn }) as unknown as ServicePeriod;

describe('partyBucket', () => {
	it('buckets by party size', () => {
		expect(partyBucket(1)).toBe('small');
		expect(partyBucket(2)).toBe('small');
		expect(partyBucket(3)).toBe('medium');
		expect(partyBucket(5)).toBe('medium');
		expect(partyBucket(6)).toBe('large');
		expect(partyBucket(12)).toBe('large');
	});
});

describe('estimateTurnMinutes', () => {
	it('falls back to the period default when history is thin', () => {
		const r = estimateTurnMinutes(4, period(120), []);
		expect(r).toEqual({ minutes: 120, basis: 'default' });
	});

	it('falls back below the sample threshold', () => {
		const few: TurnSample[] = Array.from({ length: MIN_SAMPLES - 1 }, () => ({
			partySize: 4,
			minutes: 100
		}));
		expect(estimateTurnMinutes(4, period(120), few).basis).toBe('default');
	});

	it('uses the historical median once there are enough same-bucket samples', () => {
		const samples: TurnSample[] = [
			{ partySize: 4, minutes: 95 },
			{ partySize: 3, minutes: 100 },
			{ partySize: 5, minutes: 105 },
			{ partySize: 4, minutes: 110 },
			{ partySize: 3, minutes: 90 }
		];
		const r = estimateTurnMinutes(4, period(120), samples);
		expect(r.basis).toBe('historical');
		expect(r.minutes).toBe(100); // median of [90,95,100,105,110]
	});

	it('ignores samples from other party buckets', () => {
		const samples: TurnSample[] = [
			...Array.from({ length: 6 }, () => ({ partySize: 2, minutes: 60 })), // small
			{ partySize: 4, minutes: 130 } // only one medium
		];
		// medium bucket has < MIN_SAMPLES → default
		expect(estimateTurnMinutes(4, period(120), samples).basis).toBe('default');
	});

	it('drops noise samples (too short / too long)', () => {
		const samples: TurnSample[] = [
			{ partySize: 4, minutes: 2 }, // mis-cleared
			{ partySize: 4, minutes: 500 }, // data error
			{ partySize: 4, minutes: 100 },
			{ partySize: 4, minutes: 110 },
			{ partySize: 4, minutes: 90 }
		];
		// only 3 valid → below threshold → default
		expect(estimateTurnMinutes(4, period(120), samples).basis).toBe('default');
	});

	it('clamps a skewed learned median to ±60% of the default', () => {
		const samples: TurnSample[] = Array.from({ length: 6 }, () => ({
			partySize: 4,
			minutes: 300 // way over
		}));
		const r = estimateTurnMinutes(4, period(120), samples);
		expect(r.minutes).toBe(192); // 120 * 1.6
	});
});

describe('predictFree', () => {
	const seated = Date.parse('2026-06-26T19:00:00Z');

	it('predicts the free time and minutes remaining', () => {
		const now = Date.parse('2026-06-26T19:30:00Z');
		const p = predictFree(seated, 120, now, 'default');
		expect(p.freeAtMs).toBe(Date.parse('2026-06-26T21:00:00Z'));
		expect(p.minutesUntilFree).toBe(90);
		expect(p.overdue).toBe(false);
		expect(p.seatedForMinutes).toBe(30);
		expect(p.basis).toBe('default');
	});

	it('flags overdue once past the predicted free time', () => {
		const now = Date.parse('2026-06-26T21:30:00Z');
		const p = predictFree(seated, 120, now, 'historical');
		expect(p.overdue).toBe(true);
		expect(p.minutesUntilFree).toBe(-30);
	});
});
