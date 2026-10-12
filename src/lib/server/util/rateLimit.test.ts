import { describe, it, expect, beforeEach } from 'vitest';
import {
	rateLimit,
	clientKey,
	__resetRateLimits,
	BOOKING_CREATE,
	LOGIN_ATTEMPT
} from './rateLimit.js';

const RULE = { windowMs: 1000, max: 3 };

describe('rateLimit', () => {
	beforeEach(() => __resetRateLimits());

	it('allows up to max requests in a window', () => {
		expect(rateLimit('a', RULE, 0).ok).toBe(true);
		expect(rateLimit('a', RULE, 10).ok).toBe(true);
		expect(rateLimit('a', RULE, 20).ok).toBe(true);
	});

	it('blocks the request past max', () => {
		for (let i = 0; i < 3; i++) rateLimit('a', RULE, i);
		const blocked = rateLimit('a', RULE, 4);
		expect(blocked.ok).toBe(false);
		expect(blocked.remaining).toBe(0);
	});

	it('counts down remaining', () => {
		expect(rateLimit('a', RULE, 0).remaining).toBe(2);
		expect(rateLimit('a', RULE, 1).remaining).toBe(1);
		expect(rateLimit('a', RULE, 2).remaining).toBe(0);
	});

	it('keys are independent', () => {
		for (let i = 0; i < 3; i++) rateLimit('a', RULE, i);
		expect(rateLimit('a', RULE, 4).ok).toBe(false);
		expect(rateLimit('b', RULE, 4).ok).toBe(true);
	});

	it('slides: allowance returns as old hits age out', () => {
		rateLimit('a', RULE, 0);
		rateLimit('a', RULE, 100);
		rateLimit('a', RULE, 200);
		expect(rateLimit('a', RULE, 900).ok).toBe(false);
		// the hit at t=0 leaves the window at t=1000
		expect(rateLimit('a', RULE, 1001).ok).toBe(true);
	});

	it('does not extend the lockout when a blocked caller keeps hammering', () => {
		// A guest mashing refresh must not push their own unblock time out forever.
		for (let i = 0; i < 3; i++) rateLimit('a', RULE, i);
		for (let t = 10; t < 900; t += 10) rateLimit('a', RULE, t); // all rejected
		// The window is still measured from the ORIGINAL three hits, so it frees up
		// on schedule rather than being renewed by the rejected traffic.
		expect(rateLimit('a', RULE, 1001).ok).toBe(true);
	});

	it('reports a sane retryAfter in whole seconds', () => {
		for (let i = 0; i < 3; i++) rateLimit('a', RULE, 0);
		const r = rateLimit('a', RULE, 400);
		expect(r.ok).toBe(false);
		expect(r.retryAfter).toBe(1); // 600ms left, rounded up, floor of 1
	});

	it('ships rules that are generous to guests and tight on passwords', () => {
		expect(BOOKING_CREATE.max).toBeLessThanOrEqual(10);
		expect(BOOKING_CREATE.windowMs).toBe(60 * 60 * 1000);
		expect(LOGIN_ATTEMPT.max).toBeLessThanOrEqual(10);
	});
});

describe('clientKey', () => {
	const req = (headers: Record<string, string>) => new Request('https://x.test', { headers });

	it('takes the leftmost x-forwarded-for entry (the original client)', () => {
		const key = clientKey(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' }), () => 'fb');
		expect(key).toBe('1.2.3.4');
	});

	it('falls back to x-real-ip, then to the platform address', () => {
		expect(clientKey(req({ 'x-real-ip': '5.6.7.8' }), () => 'fb')).toBe('5.6.7.8');
		expect(clientKey(req({}), () => 'fb')).toBe('fb');
	});

	it('never throws when the platform cannot supply an address', () => {
		expect(
			clientKey(req({}), () => {
				throw new Error('no address');
			})
		).toBe('unknown');
	});
});
