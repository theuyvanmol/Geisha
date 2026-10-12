// The ONE booking reference, shared by every surface.
//
// WHY THIS FILE EXISTS
// --------------------
// There used to be two references for the same booking. The guest was emailed a
// 7-character code derived from a SHA-256 of the booking id; the admin printed
// `id.slice(-6).toUpperCase()` on the diary card, in the search subtitle, on the
// printed slip and on the offline page. A guest who rang up and read out the code
// from their confirmation could not be found: typing it into the diary search
// returned "No matches". That is the one job a quotable reference has.
//
// The guest-facing code wins, because it is the one already sitting in real
// guests' inboxes — changing it would strand every confirmation ever sent. So this
// module holds that algorithm, byte-for-byte, and every surface now calls it.
//
// WHY A HAND-ROLLED SHA-256
// -------------------------
// The original lived in a server-only module and used `node:crypto`. The diary
// card, the floor adapter and the offline page all render in the BROWSER, where
// `node:crypto` does not exist and Web Crypto's `subtle.digest` is async — no use
// inside a synchronous `$derived`. Rather than let the client keep a second,
// cheaper algorithm (which is exactly how the two drifted apart), the hash is
// implemented here in ~60 lines of plain TypeScript that runs identically in both
// places. `reference.parity.test.ts` asserts it against `node:crypto` so the two
// can never diverge silently.

/** Unambiguous over the phone: no I, L, O, 0, 1. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LEN = 7;

/** SHA-256 round constants (first 32 bits of the fractional parts of the cube
 *  roots of the first 64 primes). */
// prettier-ignore
const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** SHA-256 of a byte string. Returns the 32-byte digest. */
function sha256(bytes: Uint8Array): Uint8Array {
	let h0 = 0x6a09e667;
	let h1 = 0xbb67ae85;
	let h2 = 0x3c6ef372;
	let h3 = 0xa54ff53a;
	let h4 = 0x510e527f;
	let h5 = 0x9b05688c;
	let h6 = 0x1f83d9ab;
	let h7 = 0x5be0cd19;

	// Pad to a multiple of 64 bytes: 0x80, zeroes, then the length in bits as a
	// 64-bit big-endian integer.
	const total = Math.ceil((bytes.length + 9) / 64) * 64;
	const msg = new Uint8Array(total);
	msg.set(bytes);
	msg[bytes.length] = 0x80;
	const view = new DataView(msg.buffer);
	const bitLen = bytes.length * 8;
	view.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
	view.setUint32(total - 4, bitLen >>> 0);

	const w = new Uint32Array(64);
	for (let off = 0; off < total; off += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
		for (let i = 16; i < 64; i++) {
			const x = w[i - 15];
			const y = w[i - 2];
			const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
			const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}

		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		let f = h5;
		let g = h6;
		let h = h7;

		for (let i = 0; i < 64; i++) {
			const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
			const ch = ((e & f) ^ (~e & g)) >>> 0;
			const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
			const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
			const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
			const t2 = (S0 + maj) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + t1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (t1 + t2) >>> 0;
		}

		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
		h5 = (h5 + f) >>> 0;
		h6 = (h6 + g) >>> 0;
		h7 = (h7 + h) >>> 0;
	}

	const out = new Uint8Array(32);
	const ov = new DataView(out.buffer);
	[h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => ov.setUint32(i * 4, v));
	return out;
}

/**
 * The public reference for a booking id, e.g. 'BQZYZ9Q'. Returns '' for an empty
 * id so callers can render "no reference" rather than a bogus code.
 *
 * Stable forever for a given id, and identical on the server and in the browser.
 * Never used to LOOK UP a booking — only to quote one — so the 27^7 collision
 * space is not a correctness concern.
 */
export function bookingReference(bookingId: string): string {
	if (!bookingId) return '';
	const digest = sha256(new TextEncoder().encode(`geisha-booking-ref:${bookingId}`));
	let out = '';
	for (let i = 0; i < LEN; i++) out += ALPHABET[digest[i] % ALPHABET.length];
	return out;
}
