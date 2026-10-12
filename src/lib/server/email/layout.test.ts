import { describe, it, expect } from 'vitest';
import { renderEmail, esc, type EmailBlock } from './layout.js';

const base = (blocks: EmailBlock[]) =>
	renderEmail({
		brandId: 'fusion',
		heading: 'Your table is booked',
		preheader: 'Saturday 15 August at 19:00',
		blocks
	});

describe('esc', () => {
	it('escapes every character that can break out of markup or an attribute', () => {
		expect(esc(`<script>"x" & 'y'`)).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;');
	});
});

describe('renderEmail — html', () => {
	it('includes the heading and the preheader', () => {
		const { html } = base([{ type: 'text', text: 'Hello.' }]);
		expect(html).toContain('Your table is booked');
		expect(html).toContain('Saturday 15 August at 19:00');
	});

	it('hides the preheader from the body while keeping it in the source', () => {
		// It must reach the inbox preview but never render as visible copy.
		const { html } = base([{ type: 'text', text: 'Hello.' }]);
		const idx = html.indexOf('Saturday 15 August at 19:00');
		const preceding = html.slice(Math.max(0, idx - 200), idx);
		expect(preceding).toMatch(/display:none/);
	});

	it('escapes guest-supplied content', () => {
		// Names and CMS-authored promotion labels flow into these templates.
		const { html } = base([{ type: 'text', text: 'Hello <script>alert(1)</script>,' }]);
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('escapes values inside the details table', () => {
		const { html } = base([{ type: 'details', rows: [['Booking', '<b>x</b>']] }]);
		expect(html).not.toContain('<b>x</b>');
		expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
	});

	it('renders a button as a real anchor', () => {
		const { html } = base([
			{ type: 'button', label: 'Change or cancel', url: 'https://example.com/book/abc' }
		]);
		expect(html).toContain('href="https://example.com/book/abc"');
		expect(html).toContain('Change or cancel');
	});

	it('DROPS a non-http(s) button rather than rendering a live javascript: link', () => {
		const { html } = base([{ type: 'button', label: 'Click', url: 'javascript:alert(1)' }]);
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('Click');
	});

	it('drops an unparseable url', () => {
		const { html } = base([{ type: 'button', label: 'Click', url: 'not a url' }]);
		expect(html).not.toContain('Click');
	});

	it('uses table layout rather than flex/grid, which Outlook cannot render', () => {
		const { html } = base([{ type: 'details', rows: [['Date', 'Sat']] }]);
		expect(html).toContain('role="presentation"');
		expect(html).not.toMatch(/display:\s*(flex|grid)/);
	});

	it('declares a text colour wherever it declares a background', () => {
		// A background with no matching colour is what dark-mode clients invert
		// into black-on-black.
		const { html } = base([{ type: 'panel', title: 'Payment', text: 'A deposit was taken.' }]);
		const panel = html.slice(html.indexOf('Payment') - 400, html.indexOf('Payment'));
		expect(panel).toMatch(/background:/);
		expect(html).toMatch(/color:#1a1f2b/);
	});

	it('carries the brand footer', () => {
		const { html } = base([{ type: 'text', text: 'x' }]);
		expect(html).toContain('Geisha Fusion');
		expect(html).toContain('NE12 8AE');
	});
});

describe('renderEmail — text/plain', () => {
	it('is generated for every message', () => {
		const { text } = base([{ type: 'text', text: 'Hello there.' }]);
		expect(text).toContain('Hello there.');
		expect(text.length).toBeGreaterThan(50);
	});

	it('contains no markup', () => {
		const { text } = base([
			{ type: 'text', text: 'Hello.' },
			{ type: 'details', rows: [['Date', 'Sat 15 Aug']] },
			{ type: 'panel', title: 'Payment', text: 'Taken.' },
			{ type: 'button', label: 'Manage', url: 'https://example.com/x' }
		]);
		expect(text).not.toMatch(/<[a-z/][^>]*>/i);
	});

	it('keeps the button URL, since a text reader cannot click a label', () => {
		const { text } = base([{ type: 'button', label: 'Manage', url: 'https://example.com/x' }]);
		expect(text).toContain('Manage: https://example.com/x');
	});

	it('does NOT escape entities — it is plain text, not markup', () => {
		// Escaping here would show a guest a literal "&amp;" in their mail client.
		const { text } = base([{ type: 'text', text: 'Fish & chips' }]);
		expect(text).toContain('Fish & chips');
		expect(text).not.toContain('&amp;');
	});

	it('renders details as aligned label/value lines', () => {
		const { text } = base([
			{ type: 'details', rows: [['Date', 'Sat 15 Aug'], ['Party', '4 guests']] }
		]);
		expect(text).toMatch(/Date\s+Sat 15 Aug/);
		expect(text).toMatch(/Party\s+4 guests/);
	});

	it('says the same things as the html', () => {
		// The two are generated from one block tree; this is the guard that keeps
		// them from being maintained separately and drifting.
		const { html, text } = base([
			{ type: 'text', text: 'Your deposit of GBP60.00 has been taken.' },
			{ type: 'details', rows: [['Reference', 'BQZYZ9Q']] }
		]);
		for (const fragment of ['Your deposit of GBP60.00 has been taken.', 'BQZYZ9Q']) {
			expect(html).toContain(fragment);
			expect(text).toContain(fragment);
		}
	});
});

describe('brand accent', () => {
	it('differs between the two restaurants', () => {
		const fusion = renderEmail({
			brandId: 'fusion', heading: 'h', preheader: 'p', blocks: []
		}).html;
		const asia = renderEmail({
			brandId: 'asia', heading: 'h', preheader: 'p', blocks: []
		}).html;
		expect(fusion).toContain('#c45a3a');
		expect(asia).toContain('#b8873a');
		expect(fusion).not.toBe(asia);
	});
});
