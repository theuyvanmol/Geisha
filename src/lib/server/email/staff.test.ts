// Coverage for the two staff emails (invite + password reset).
//
// send() is mocked so we can inspect exactly what would go to Brevo. What matters
// here is not the styling but the four things that decide whether these arrive
// and work at all:
//
//   1. BOTH parts are present. HTML-only transactional mail is a spam signal, and
//      these are the two messages a locked-out manager cannot afford to miss.
//   2. The link survives into both parts — including for the reader whose client
//      strips the button.
//   3. Names are escaped. A colleague's name is typed into the team screen and
//      reaches an inbox through this file, which builds its HTML by hand.
//   4. The plain-text part contains no markup, so it reads as prose rather than
//      tag soup.

import { describe, it, expect, beforeEach, vi } from 'vitest';

type Sent = {
	to: string;
	subject: string;
	html: string;
	text?: string;
	tags?: string[];
};

const sends: Sent[] = [];
vi.mock('./send.js', () => ({
	send: async (msg: Sent) => {
		sends.push(msg);
		return { sent: true };
	}
}));

import { sendPasswordReset, sendStaffInvite } from './staff.js';

const LINK = 'https://admin.example.test/admin/reset-password?id=s1&token=abc123';

/** How the link appears inside the HTML part. The `&` separating the two query
 *  params is escaped there — that is correct HTML, and what the browser turns
 *  back into `&` on click. The text part carries the URL raw. */
const LINK_HTML = LINK.replace('&', '&amp;');

beforeEach(() => {
	sends.length = 0;
});

describe('sendStaffInvite', () => {
	it('sends both an HTML and a plain-text part, tagged for the Brevo dashboard', async () => {
		await sendStaffInvite({
			to: 'new@example.test',
			name: 'Simone',
			role: 'manager',
			invitedBy: 'Giles',
			url: LINK
		});

		expect(sends).toHaveLength(1);
		const msg = sends[0];
		expect(msg.to).toBe('new@example.test');
		expect(msg.subject).toMatch(/set up your/i);
		expect(msg.tags).toContain('staff-invite');

		expect(msg.text).toBeTruthy();
		expect(msg.html).toContain('<!doctype html>');
		// The link reaches BOTH readers: the button, and the text part.
		expect(msg.html).toContain(LINK_HTML);
		expect(msg.text).toContain(LINK);
		// Role and inviter are actually stated — the point of the email.
		expect(msg.text).toContain('Manager');
		expect(msg.text).toContain('Giles');
	});

	it('escapes a name typed into the team screen', async () => {
		await sendStaffInvite({
			to: 'x@example.test',
			name: '<script>alert(1)</script>',
			role: 'server',
			invitedBy: 'Jo & Co',
			url: LINK
		});

		const msg = sends[0];
		expect(msg.html).not.toContain('<script>');
		expect(msg.html).toContain('&lt;script&gt;');
		expect(msg.html).toContain('Jo &amp; Co');
	});

	it('still reads correctly when nobody is named as the inviter', async () => {
		await sendStaffInvite({
			to: 'x@example.test',
			name: '',
			role: 'host',
			invitedBy: '',
			url: LINK
		});
		expect(sends[0].text).toContain("You've been invited");
	});
});

describe('sendPasswordReset', () => {
	it('sends both parts, carries the link, and says the old password still works', async () => {
		await sendPasswordReset({ to: 'simone@example.test', name: 'Simone', url: LINK });

		const msg = sends[0];
		expect(msg.subject).toMatch(/reset your/i);
		expect(msg.tags).toContain('staff-password-reset');
		expect(msg.html).toContain(LINK_HTML);
		expect(msg.text).toContain(LINK);
		// The two reassurances that stop a confused person calling the owner.
		expect(msg.text).toMatch(/expires in one hour/i);
		expect(msg.text).toMatch(/current password keeps working/i);
	});

	it('leaves no markup in the plain-text part', async () => {
		await sendPasswordReset({ to: 'x@example.test', name: 'Simone', url: LINK });
		expect(sends[0].text).not.toMatch(/<[a-z/][^>]*>/i);
	});

	it('renders a non-http link as inert text rather than a live anchor', async () => {
		await sendPasswordReset({
			to: 'x@example.test',
			name: 'Simone',
			url: 'javascript:alert(1)'
		});
		expect(sends[0].html).not.toContain('javascript:');
	});
});
