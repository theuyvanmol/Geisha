// Coverage for self-service links (WP-S9-2).
//
// Two halves:
//   • the token crypto — sign↔verify round-trip, tamper rejection (id / exp /
//     signature), expiry, and the no-secret disabled state; and
//   • the AUTHORISATION guards on the actions those links reach. `canCancel` on
//     the page only decides whether a button is drawn, so the gate that actually
//     stops a direct POST lives in selfServiceCancel and is tested here.
// The wider amend rules live in amend.test.ts; the money paths in payments.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// $env/dynamic/private is a SvelteKit virtual module; mock it so the secret is
// deterministic and mutable per-test. vi.hoisted keeps the holder available to
// the hoisted vi.mock factory.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

// pb: the token functions never call it, but selfServiceCancel does — it reads the
// booking back to enforce its own status gate. A one-collection fake is enough.
const { bookings } = vi.hoisted(() => ({ bookings: [] as Record<string, unknown>[] }));
vi.mock('../db/pb.js', () => ({
	pb: vi.fn(async () => ({
		collection: () => ({
			async getOne(id: string) {
				const row = bookings.find((b) => b.id === id);
				if (!row) throw Object.assign(new Error('not found'), { status: 404 });
				return structuredClone(row);
			}
		})
	}))
}));

// The real cancel path is covered in payments.test.ts; here we only care whether
// selfServiceCancel lets a call REACH it.
const { cancelSpy } = vi.hoisted(() => ({ cancelSpy: vi.fn(async () => ({ status: 'cancelled' })) }));
vi.mock('./mutate.js', () => ({ cancelBooking: cancelSpy }));

import {
	signBookingToken,
	verifyBookingToken,
	signScopedToken,
	verifyScopedToken,
	buildManagementUrl,
	expiryForBooking,
	selfServiceCancel,
	isConfigured
} from './selfservice.js';

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	mockEnv.BOOKING_LINK_SECRET = 'unit-test-secret-key';
	bookings.length = 0;
	cancelSpy.mockClear();
});

describe('signBookingToken / verifyBookingToken', () => {
	it('round-trips to the same booking id', () => {
		const token = signBookingToken('bkg_123');
		expect(token).toBeTruthy();
		expect(verifyBookingToken(token)).toEqual({ bookingId: 'bkg_123' });
	});

	it('round-trips ids that contain dots / underscores', () => {
		const id = 'r_abc.def_123';
		const token = signBookingToken(id);
		expect(verifyBookingToken(token)).toEqual({ bookingId: id });
	});

	it('rejects a token whose signature byte was flipped', () => {
		const token = signBookingToken('bkg_123');
		const [payload, sig] = token.split('.');
		// Flip the FIRST character, not the last. A 32-byte HMAC is 43 base64url
		// chars, so the final char carries only 4 significant bits — swapping it
		// A<->B can change nothing but padding, decode to identical bytes and verify
		// fine. Since the signed payload embeds a wall-clock expiry, the signature
		// (and therefore that last char) differs every run, which made this test
		// fail at random. Every bit of the first char is significant.
		const first = sig.slice(0, 1);
		const swapped = first === 'A' ? 'Q' : 'A';
		const forged = `${payload}.${swapped}${sig.slice(1)}`;
		expect(verifyBookingToken(forged)).toBeNull();
	});

	it('rejects a token whose payload (id) was tampered', () => {
		const token = signBookingToken('bkg_123');
		const sig = token.split('.')[1];
		// re-encode a different id with the OLD signature
		const evil = Buffer.from('bkg_999.9999999999').toString('base64url');
		expect(verifyBookingToken(`${evil}.${sig}`)).toBeNull();
	});

	it('rejects an expired token', () => {
		const past = Math.floor(Date.now() / 1000) - 10;
		const token = signBookingToken('bkg_123', past);
		expect(verifyBookingToken(token)).toBeNull();
	});

	it('accepts a far-future expiry', () => {
		const future = Math.floor(Date.now() / 1000) + 1000;
		const token = signBookingToken('bkg_123', future);
		expect(verifyBookingToken(token)).toEqual({ bookingId: 'bkg_123' });
	});

	it('rejects garbage / malformed tokens', () => {
		expect(verifyBookingToken('')).toBeNull();
		expect(verifyBookingToken('not-a-token')).toBeNull();
		expect(verifyBookingToken('a.b.c')).toBeNull();
		expect(verifyBookingToken('!!!.???')).toBeNull();
	});

	it('a token signed under a different secret does not verify', () => {
		const token = signBookingToken('bkg_123');
		mockEnv.BOOKING_LINK_SECRET = 'a-completely-different-secret';
		expect(verifyBookingToken(token)).toBeNull();
	});
});

describe('graceful no-secret state', () => {
	it('falls back to the derived secret when only POCKETBASE_ADMIN_PASSWORD is set', () => {
		delete mockEnv.BOOKING_LINK_SECRET;
		mockEnv.POCKETBASE_ADMIN_PASSWORD = 'pb-admin-pw';
		expect(isConfigured()).toBe(true);
		const token = signBookingToken('bkg_123');
		expect(token).toBeTruthy();
		expect(verifyBookingToken(token)).toEqual({ bookingId: 'bkg_123' });
	});

	it('disables links entirely when no secret material exists', () => {
		delete mockEnv.BOOKING_LINK_SECRET;
		delete mockEnv.POCKETBASE_ADMIN_PASSWORD;
		expect(isConfigured()).toBe(false);
		expect(signBookingToken('bkg_123')).toBe('');
		expect(verifyBookingToken('anything')).toBeNull();
		expect(buildManagementUrl('bkg_123', 'https://x.test')).toBe('');
	});
});

describe('buildManagementUrl', () => {
	it('produces a verifiable /book/<token> URL and trims a trailing slash', () => {
		const url = buildManagementUrl('bkg_123', 'https://geisha.test/');
		expect(url.startsWith('https://geisha.test/book/')).toBe(true);
		const token = url.split('/book/')[1];
		expect(verifyBookingToken(token)).toEqual({ bookingId: 'bkg_123' });
	});
});

describe('expiryForBooking', () => {
	it('dies a fortnight after the meal, not six months after the booking', () => {
		const ends = '2026-06-25T20:00:00.000Z';
		const exp = expiryForBooking(ends);
		const expectedDays = 14;
		const actualDays = (exp - Math.floor(new Date(ends).getTime() / 1000)) / 86_400;
		expect(actualDays).toBeCloseTo(expectedDays, 5);
	});

	it('never EXTENDS a link past the flat default', () => {
		// A booking years out must not mint a token valid for years.
		const far = new Date(Date.now() + 900 * 86_400_000).toISOString();
		const maxExp = Math.floor(Date.now() / 1000) + 180 * 86_400;
		expect(expiryForBooking(far)).toBeLessThanOrEqual(maxExp);
	});

	it('falls back to the default for a missing or unparseable date', () => {
		const floor = Math.floor(Date.now() / 1000) + 179 * 86_400;
		expect(expiryForBooking(undefined)).toBeGreaterThan(floor);
		expect(expiryForBooking('not a date')).toBeGreaterThan(floor);
	});
});

describe('selfServiceCancel — the status gate is server-side, not just UI', () => {
	function seed(status: string, startsAt: string) {
		bookings.push({ id: 'bk1', status, starts_at: startsAt, restaurant: 'r1', customer: 'c1' });
	}
	const FUTURE = () => new Date(Date.now() + 48 * 3600 * 1000).toISOString();
	const PAST = () => new Date(Date.now() - 48 * 3600 * 1000).toISOString();

	// Stamped with ResDiary's "Online Cancellation" reason so the cancellation
	// report separates a guest cancelling themselves from anything staff did.
	it('cancels an upcoming confirmed booking, as an online cancellation', async () => {
		seed('confirmed', FUTURE());
		await selfServiceCancel('bk1');
		expect(cancelSpy).toHaveBeenCalledWith('bk1', 'customer', { reason: 'online_cancellation' });
	});

	// The money case as it was: cancelBooking treated any past booking as a LATE
	// cancel and routed to chargeNoShow, billing an attended guest's filed card. A
	// cancel no longer charges anything, but the status gate still stands on its own.
	it('refuses a completed booking, so no no-show fee can be triggered', async () => {
		seed('completed', PAST());
		await expect(selfServiceCancel('bk1')).rejects.toThrow();
		expect(cancelSpy).not.toHaveBeenCalled();
	});

	it('refuses a seated booking (party is mid-service)', async () => {
		seed('seated', FUTURE());
		await expect(selfServiceCancel('bk1')).rejects.toThrow();
		expect(cancelSpy).not.toHaveBeenCalled();
	});

	it('refuses an already-started booking even when still marked confirmed', async () => {
		seed('confirmed', PAST());
		await expect(selfServiceCancel('bk1')).rejects.toThrow();
		expect(cancelSpy).not.toHaveBeenCalled();
	});

	it('refuses a booking that is already cancelled', async () => {
		seed('cancelled', FUTURE());
		await expect(selfServiceCancel('bk1')).rejects.toThrow();
		expect(cancelSpy).not.toHaveBeenCalled();
	});
});

describe('signScopedToken / verifyScopedToken', () => {
	const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;

	it('round-trips within its own scope', () => {
		const token = signScopedToken('feedback', 'bkg_123', inAnHour());
		expect(verifyScopedToken('feedback', token)).toEqual({ id: 'bkg_123' });
	});

	it('is refused by a different scope', () => {
		const token = signScopedToken('feedback', 'bkg_123', inAnHour());
		expect(verifyScopedToken('something-else', token)).toBeNull();
	});

	// The reason scopes exist: a link that only asks "how was your meal?" must not
	// open the page that cancels the booking — and the reverse.
	it('cannot be used as a booking-management token, nor vice versa', () => {
		const feedback = signScopedToken('feedback', 'bkg_123', inAnHour());
		expect(verifyBookingToken(feedback)).toBeNull();

		const manage = signBookingToken('bkg_123', inAnHour());
		expect(verifyScopedToken('feedback', manage)).toBeNull();
	});

	// Re-encoding a feedback token's payload as `feedback:<id>.<exp>` must not produce
	// something the booking verifier accepts (it would yield bookingId 'feedback:<id>').
	it('cannot be re-encoded into a booking token by prefixing the scope', () => {
		const exp = inAnHour();
		const sig = signScopedToken('feedback', 'bkg_123', exp).split('.')[1];
		const forged = `${Buffer.from(`feedback:bkg_123.${exp}`).toString('base64url')}.${sig}`;
		expect(verifyBookingToken(forged)).toBeNull();
	});

	it('rejects an expired token', () => {
		const token = signScopedToken('feedback', 'bkg_123', Math.floor(Date.now() / 1000) - 1);
		expect(verifyScopedToken('feedback', token)).toBeNull();
	});

	it('rejects a tampered id', () => {
		const token = signScopedToken('feedback', 'bkg_123', inAnHour());
		const sig = token.split('.')[1];
		const evil = Buffer.from(`bkg_999.${inAnHour()}`).toString('base64url');
		expect(verifyScopedToken('feedback', `${evil}.${sig}`)).toBeNull();
	});

	it('mints nothing and verifies nothing without a secret', () => {
		delete mockEnv.BOOKING_LINK_SECRET;
		expect(signScopedToken('feedback', 'bkg_123', inAnHour())).toBe('');
		expect(verifyScopedToken('feedback', 'abc.def')).toBeNull();
	});
});
