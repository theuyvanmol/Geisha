// The browser-side Stripe loader, run against a stand-in `window.Stripe`.
//
// 2026-09-11: the card form told Geisha Asia's guests "you allow Geisha Bar and
// Grill to charge your card…" — the Stripe ACCOUNT's public name, which is the
// Jesmond site's. Stripe lets the page supply the name the Payment Element uses, so
// the widget passes the restaurant the guest is actually booking.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Created = { type: string; opts: Record<string, unknown> };
let created: Created[] = [];

function fakeStripe() {
	return {
		elements: () => ({
			create: (type: string, opts: Record<string, unknown>) => {
				created.push({ type, opts });
				return {
					mount() {},
					on(event: string, cb: () => void) {
						if (event === 'ready') setTimeout(cb, 0);
					},
					destroy() {}
				};
			}
		})
	};
}

const g = globalThis as Record<string, unknown>;

beforeEach(() => {
	created = [];
	vi.resetModules();
});

afterEach(() => {
	delete g.window;
	delete g.Stripe;
	delete g.document;
});

describe('loadStripe', () => {
	beforeEach(() => {
		g.window = globalThis;
		g.Stripe = vi.fn(fakeStripe);
	});

	it("names the restaurant on the card form, not the Stripe account's own name", async () => {
		const { loadStripe } = await import('./stripe');
		await loadStripe('pk_test_x', 'pi_x_secret_y', { businessName: 'Geisha Asia' });
		expect(created[0].type).toBe('payment');
		expect(created[0].opts.business).toEqual({ name: 'Geisha Asia' });
	});

	it('leaves the name to Stripe when the page gives none', async () => {
		const { loadStripe } = await import('./stripe');
		await loadStripe('pk_test_x', 'pi_x_secret_y');
		expect(created[0].opts).not.toHaveProperty('business');
	});
});

// On a slow phone line the card form took ~11s to appear after "Complete booking",
// ~2s of it downloading Stripe.js — time spent staring at an empty box. Starting the
// download while the guest is still typing their details takes that off the wait.
describe('preloadStripe', () => {
	it('starts downloading Stripe.js before any card form is needed', async () => {
		const appended: Array<{ src?: string }> = [];
		g.window = globalThis;
		g.document = {
			querySelector: () => null,
			createElement: () => ({ addEventListener() {} }),
			head: { appendChild: (el: { src?: string }) => appended.push(el) }
		};
		const { preloadStripe } = await import('./stripe');
		preloadStripe();
		expect(appended).toHaveLength(1);
		expect(appended[0].src).toMatch(/^https:\/\/js\.stripe\.com\//);
	});

	it('does nothing when Stripe.js is already on the page', async () => {
		const appended: unknown[] = [];
		g.window = globalThis;
		g.Stripe = vi.fn(fakeStripe);
		g.document = {
			querySelector: () => null,
			createElement: () => ({ addEventListener() {} }),
			head: { appendChild: (el: unknown) => appended.push(el) }
		};
		const { preloadStripe } = await import('./stripe');
		preloadStripe();
		expect(appended).toHaveLength(0);
	});
});
