// The isomorphic reference MUST agree with the original node:crypto implementation
// for every id, forever. Real guests are holding printed/emailed copies of codes
// produced by the old one; a drift here silently invalidates all of them.
//
// So this test re-implements the original inline (node:crypto, same salt, same
// alphabet) and asserts equality across a spread of real-shaped ids, including the
// ones the 6 Aug 2026 QA sweep actually put in front of a guest.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { bookingReference } from './reference';

/** The original, verbatim — the contract we must not break. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function original(bookingId: string): string {
	if (!bookingId) return '';
	const digest = createHash('sha256').update(`geisha-booking-ref:${bookingId}`).digest();
	let out = '';
	for (let i = 0; i < 7; i++) out += ALPHABET[digest[i] % ALPHABET.length];
	return out;
}

describe('bookingReference parity with the original node:crypto version', () => {
	it('matches on the references the QA sweep emailed to a guest', () => {
		// booking id -> the code that actually went out in the confirmation email.
		const observed: Record<string, string> = {
			xu2djd3547ct2x8: '2W8JZ7P',
			uyr36p4st7r0376: 'VXFH2A7',
			iuzr9xl5tw3ay2u: '3F7MV6G',
			h2cr9ne8gczngig: '8GP2GZR',
			yn3ifgzuy6zqz3s: 'VBNVG5B',
			cwn9hlvcp75so7r: 'KYXF2QB'
		};
		for (const [id, code] of Object.entries(observed)) {
			expect(bookingReference(id), `id ${id}`).toBe(code);
			expect(original(id), `original for ${id}`).toBe(code);
		}
	});

	it('matches node:crypto across a wide spread of ids', () => {
		const ids: string[] = [];
		// PocketBase ids are 15 chars of [a-z0-9]; generate deterministically.
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let seed = 12345;
		for (let n = 0; n < 500; n++) {
			let id = '';
			for (let i = 0; i < 15; i++) {
				seed = (seed * 1103515245 + 12345) & 0x7fffffff;
				id += chars[seed % chars.length];
			}
			ids.push(id);
		}
		for (const id of ids) expect(bookingReference(id)).toBe(original(id));
	});

	it('matches on edge-shaped inputs (length crosses the SHA-256 block boundary)', () => {
		const edges = [
			'',
			'a',
			'ab',
			'x'.repeat(21), // salt+id = 41 bytes, one block
			'x'.repeat(38), // salt+id = 58 bytes, still one block (needs 9 bytes padding)
			'x'.repeat(39), // salt+id = 59 bytes — padding spills into a SECOND block
			'x'.repeat(40),
			'x'.repeat(55),
			'x'.repeat(64),
			'x'.repeat(119),
			'x'.repeat(120),
			'x'.repeat(1000),
			'émoji-ünicode-🍣' // multi-byte UTF-8 must encode the same way
		];
		for (const id of edges) expect(bookingReference(id), `id len ${id.length}`).toBe(original(id));
	});

	it('returns 7 characters from the unambiguous alphabet', () => {
		for (const id of ['abc123def456ghi', 'zzz999zzz999zzz']) {
			const ref = bookingReference(id);
			expect(ref).toHaveLength(7);
			expect(ref).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$/);
			expect(ref).not.toMatch(/[ILO01]/);
		}
	});

	it('is stable across calls', () => {
		expect(bookingReference('xu2djd3547ct2x8')).toBe(bookingReference('xu2djd3547ct2x8'));
	});
});
