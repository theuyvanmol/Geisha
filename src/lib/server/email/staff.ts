// Staff-facing emails (account setup + password reset).
//
// These go to a colleague, not a guest, so they DON'T log to geisha_messages
// (that collection requires a customer id and is the guest-comms audit trail)
// and they DON'T use email/layout.ts — that renderer signs every message with a
// single brand's name, phone and "you're receiving this because of a booking"
// footer, none of which is true of an email telling a manager to pick a password.
// So this file keeps its own shell, at the organisation level.
//
// WHAT IT DOES BORROW from layout.ts, because both matter more than tidiness:
//
//   1. A text/plain alternative rendered from the same content. An HTML-only
//      transactional email is a recognised spam signal, and these two are the
//      messages that MUST arrive — if a password-reset link lands in spam the
//      person is simply locked out of the back office.
//   2. A preheader, so the inbox line beside the subject says what to do rather
//      than scraping "Hello there,".
//
// Both are sent through send(), so they follow the same provider precedence as
// everything else: Brevo when a key is configured, Resend otherwise, and a
// console log in dev with neither. Each carries a Brevo tag so staff mail is
// filterable from guest confirmations in the provider's dashboard.

import { send } from './send.js';
import { esc } from './layout.js';

const ACCENT = '#b8873a'; // Geisha gold — staff mail is brand-neutral
const INK = '#1a1f2b';
const MUTED = '#6b7488';
const FAINT = '#8591a8';
const RULE = '#e3e6ec';
const PAPER = '#ffffff';
const OUTER = '#f4f2ee';

const ORG = 'Geisha Restaurants';
const ORG_ADDRESS = 'Front Street, Benton, Newcastle Upon Tyne, NE12 8AE';

/** Only http(s) may become a live link. These URLs are built from the request
 *  origin, so a bad value should degrade to inert text, not an exploit. */
function safeUrl(url: string): string | null {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * `text` on the two prose blocks is emitted as HTML, so a few words can be bold
 * without a block type per emphasis. THE CALLER OWNS ESCAPING: every interpolated
 * value — a colleague's name typed into the team screen, a role label — must go
 * through esc() before it reaches here. The plain-text renderer strips the markup
 * back out, so the two halves still say the same thing.
 */
type Block =
	| { type: 'text'; text: string }
	/** Smaller and muted — expiry notes and the "ignore this" reassurance. */
	| { type: 'note'; text: string }
	| { type: 'button'; label: string; url: string }
	/** The full link in small type, for clients that strip the button. */
	| { type: 'rawlink'; url: string };

interface StaffEmail {
	heading: string;
	/** The grey line the inbox shows after the subject. */
	preheader: string;
	blocks: Block[];
}

function blockHtml(block: Block): string {
	switch (block.type) {
		case 'text':
			return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${block.text}</p>`;
		case 'note':
			return `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:${MUTED}">${block.text}</p>`;
		case 'button': {
			const href = safeUrl(block.url);
			if (!href) return '';
			// Padding on the <a>, not the cell: Outlook drops cell padding around a
			// nested anchor and the button collapses to a bare link.
			return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">
				<tr><td style="background:${ACCENT};border-radius:4px">
					<a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${esc(block.label)}</a>
				</td></tr>
			</table>`;
		}
		case 'rawlink': {
			const href = safeUrl(block.url);
			if (!href) return '';
			return `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${FAINT};word-break:break-all">If the button doesn't work, copy this link into your browser:<br><a href="${esc(href)}" style="color:${FAINT}">${esc(href)}</a></p>`;
		}
	}
}

function blockText(block: Block): string | null {
	switch (block.type) {
		case 'text':
		case 'note':
			// The text part is built from the same tree, so it can't drift from the
			// HTML — but the HTML strings carry <strong> markup, which has to come
			// back out here rather than reach the plain-text reader as tag soup.
			return block.text.replace(/<[^>]+>/g, '');
		case 'button': {
			const href = safeUrl(block.url);
			return href ? `${block.label}:\n${href}` : null;
		}
		case 'rawlink':
			return null; // the button line already carried the URL
	}
}

/** Render one staff email to html + text. Tables and inline styles throughout,
 *  deliberately: Outlook renders with Word's engine — no flexbox, no grid, and
 *  <style> blocks are ignored outright in some versions. */
function render(email: StaffEmail): { html: string; text: string } {
	const body = email.blocks.map(blockHtml).join('\n');

	const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(email.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${OUTER};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(email.preheader)}&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${OUTER}">
	<tr><td align="center" style="padding:24px 12px">
		<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${PAPER};border-radius:6px;overflow:hidden">
			<tr><td style="height:4px;background:${ACCENT};font-size:0;line-height:0">&nbsp;</td></tr>
			<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif">
				<p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${MUTED}">${esc(ORG)} · Staff admin</p>
				<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:400;color:${INK}">${esc(email.heading)}</h1>
			</td></tr>
			<tr><td style="padding:0 28px 8px;font-family:Arial,Helvetica,sans-serif">
				${body}
			</td></tr>
			<tr><td style="padding:8px 28px 28px;font-family:Arial,Helvetica,sans-serif">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
					<tr><td style="border-top:1px solid ${RULE};padding-top:16px">
						<p style="margin:0;font-size:12px;line-height:1.6;color:${FAINT}">${esc(ORG)} · ${esc(ORG_ADDRESS)}</p>
						<p style="margin:10px 0 0;font-size:11px;line-height:1.5;color:${FAINT}">
							This is an automated message about your staff account. It isn't marketing, so there's nothing to unsubscribe from.
						</p>
					</td></tr>
				</table>
			</td></tr>
		</table>
	</td></tr>
</table>
</body></html>`;

	const text = [
		`${ORG.toUpperCase()} · STAFF ADMIN`,
		'',
		email.heading,
		'',
		email.blocks
			.map(blockText)
			.filter((t): t is string => Boolean(t))
			.join('\n\n'),
		'',
		'--',
		`${ORG} · ${ORG_ADDRESS}`,
		'This is an automated message about your staff account.'
	].join('\n');

	return { html, text };
}

const ROLE_LABEL: Record<string, string> = {
	owner: 'Owner',
	manager: 'Manager',
	host: 'Host',
	server: 'Server'
};

/**
 * Email a new staff member their account-setup link. The link is single-use and
 * time-limited (validated server-side on accept). Returns { sent } — best-effort;
 * the caller surfaces the link in the UI as a fallback when email isn't configured
 * or didn't arrive.
 */
export async function sendStaffInvite(input: {
	to: string;
	name: string;
	role: string;
	invitedBy: string;
	url: string;
}): Promise<{ sent: boolean }> {
	// Escaped like every other template: a name typed into the team screen reaches
	// an inbox through here, and this file builds its HTML by hand.
	const name = esc(input.name || 'there');
	const invitedBy = esc(input.invitedBy);
	const role = esc(ROLE_LABEL[input.role] ?? input.role);

	const { html, text } = render({
		heading: 'Set up your admin account',
		preheader: `Choose a password to activate your ${ORG} admin account. The link expires in 72 hours.`,
		blocks: [
			{ type: 'text', text: `Hello ${name},` },
			{
				type: 'text',
				text: invitedBy
					? `<strong>${invitedBy}</strong> has invited you to the ${esc(ORG)} admin as a <strong>${role}</strong>.`
					: `You've been invited to the ${esc(ORG)} admin as a <strong>${role}</strong>.`
			},
			{
				type: 'text',
				text: 'Choose a password below and your account is ready — you can sign in straight away, on any device.'
			},
			{ type: 'button', label: 'Set up my account', url: input.url },
			{
				type: 'note',
				text: 'This link works once and expires in 72 hours. If it has already expired, ask an owner to resend your invite. If you weren’t expecting this, you can safely ignore this email.'
			},
			{ type: 'rawlink', url: input.url }
		]
	});

	return send({
		to: input.to,
		subject: `Set up your ${ORG} admin account`,
		html,
		text,
		tags: ['staff-invite']
	});
}

/**
 * Email a staff member a password-reset link.
 *
 * Only ever sent to the address already on the account, so the request itself
 * proves nothing — which is what lets /admin/forgot-password answer identically
 * whether or not the address exists.
 */
export async function sendPasswordReset(input: {
	to: string;
	name: string;
	url: string;
}): Promise<{ sent: boolean }> {
	const name = esc(input.name || 'there');

	const { html, text } = render({
		heading: 'Reset your password',
		preheader: `Choose a new password for your ${ORG} admin account. The link expires in one hour.`,
		blocks: [
			{ type: 'text', text: `Hello ${name},` },
			{
				type: 'text',
				text: `Someone asked to reset the password for your ${esc(ORG)} admin account. Use the button below to choose a new one.`
			},
			{ type: 'button', label: 'Choose a new password', url: input.url },
			{
				type: 'note',
				text: 'This link works once and expires in one hour. Until you use it, your current password keeps working.'
			},
			{
				type: 'note',
				text: 'If you didn’t ask for this, you can ignore this email — nothing has changed, and nobody can get into your account without this link.'
			},
			{ type: 'rawlink', url: input.url }
		]
	});

	return send({
		to: input.to,
		subject: `Reset your ${ORG} admin password`,
		html,
		text,
		tags: ['staff-password-reset']
	});
}
