// One email layout, rendered to BOTH html and plain text.
//
// WHY A SHARED RENDERER
// ---------------------
// There were three hand-rolled `shell()` functions (confirmations, staff, comms
// drafts) drifting apart, all HTML-only. That matters for two reasons beyond
// tidiness:
//
//   1. DELIVERABILITY. A transactional email with no text/plain part is a
//      recognised spam signal, and Gmail in particular weighs it. Every message
//      built here gets a real text alternative — written from the same content
//      tree, not scraped out of the HTML, so it reads like something a person
//      would send rather than tag soup.
//   2. CLIENTS ARE NOT BROWSERS. Outlook renders with Word's engine: no flexbox,
//      no grid, unreliable padding on divs, and it ignores <style> blocks in
//      some versions. So this is tables + inline styles, deliberately, and it
//      will look wrong next to the rest of this codebase. That is correct for
//      email.
//
// DARK MODE: every colour is stated explicitly (including background AND text on
// the same element). Clients that auto-invert leave declared pairs alone; a
// background with no matching colour is exactly what gets flipped to black-on-black.

import { getBrand, type BrandId } from '../../data/brand.js';

/** Per-brand accent. Matches the site's tokens closely enough to feel related
 *  without depending on CSS the inbox will never load. */
const ACCENT: Record<BrandId, string> = {
	asia: '#b8873a',
	fusion: '#c45a3a'
};

const INK = '#1a1f2b';
const MUTED = '#6b7488';
const FAINT = '#8591a8';
const RULE = '#e3e6ec';
const PAPER = '#ffffff';
const OUTER = '#f4f2ee';

/** A row in the booking-details table. */
export type DetailRow = [label: string, value: string];

export type EmailBlock =
	| { type: 'text'; text: string }
	/** Smaller, muted — for policy notes and reassurance. */
	| { type: 'note'; text: string }
	/** The boxed date/time/party/reference summary. */
	| { type: 'details'; rows: DetailRow[] }
	/** A tinted callout, e.g. a deposit receipt or a warning. */
	| { type: 'panel'; title?: string; text: string }
	| { type: 'button'; label: string; url: string }
	/**
	 * A row of tappable scores, e.g. 0..5 — one link per score (`urls[i]` is score
	 * `i`). The text part can't show buttons, so it carries the single `textUrl`.
	 */
	| { type: 'scores'; urls: string[]; lowLabel: string; highLabel: string; textUrl: string }
	/** Horizontal rule. */
	| { type: 'divider' };

export interface EmailContent {
	brandId: BrandId;
	/** Big line at the top, e.g. "Your table is booked". */
	heading: string;
	/**
	 * The grey line inboxes show after the subject. Without one, clients scrape
	 * the first text they find — usually "Hello there," which tells the guest
	 * nothing and wastes the most valuable line in the inbox.
	 */
	preheader: string;
	blocks: EmailBlock[];
	/**
	 * Replaces the default "because of a booking … nothing to unsubscribe from"
	 * footer line. Needed by any email that DOES have something to stop (the
	 * feedback request) or isn't to a guest at all (a staff alert).
	 */
	footer?: { text: string; linkLabel?: string; linkUrl?: string };
}

export interface RenderedEmail {
	html: string;
	text: string;
}

/** Escape for HTML text nodes and attribute values. Everything routed through
 *  here may contain a guest's own name or a CMS-authored promotion label. */
export function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Only http(s) links may become anchors or buttons. Anything else (javascript:,
 *  data:) is rendered as inert text — these templates interpolate URLs built from
 *  configuration, and a bad value should degrade, not become a live exploit. */
function safeUrl(url: string): string | null {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
	} catch {
		return null;
	}
}

function renderBlockHtml(block: EmailBlock, accent: string): string {
	switch (block.type) {
		case 'text':
			return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${esc(block.text)}</p>`;

		case 'note':
			return `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:${MUTED}">${esc(block.text)}</p>`;

		case 'divider':
			return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-top:1px solid ${RULE};font-size:0;line-height:0">&nbsp;</td></tr></table>`;

		case 'details': {
			// A table, not a definition list: Outlook collapses <dl> margins and
			// left-aligns everything, which turns a tidy summary into a jumble.
			const rows = block.rows
				.map(
					([label, value], i) => `
				<tr>
					<td style="padding:9px 12px 9px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};white-space:nowrap;${i ? `border-top:1px solid ${RULE};` : ''}">${esc(label)}</td>
					<td style="padding:9px 0;font-size:15px;color:${INK};text-align:right;${i ? `border-top:1px solid ${RULE};` : ''}">${esc(value)}</td>
				</tr>`
				)
				.join('');
			return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${RULE};border-radius:4px">
				<tr><td style="padding:4px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
			</table>`;
		}

		case 'panel':
			return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
				<tr><td style="border-left:3px solid ${accent};background:#faf8f5;padding:14px 16px">
					${block.title ? `<p style="margin:0 0 6px;font-size:14px;font-weight:600;color:${INK}">${esc(block.title)}</p>` : ''}
					<p style="margin:0;font-size:14px;line-height:1.6;color:${INK}">${esc(block.text)}</p>
				</td></tr>
			</table>`;

		case 'button': {
			const href = safeUrl(block.url);
			if (!href) return '';
			// Padding on the <a> rather than the cell: Outlook drops cell padding on
			// a nested anchor and the button becomes a bare link.
			return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
				<tr><td style="background:${accent};border-radius:4px">
					<a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${esc(block.label)}</a>
				</td></tr>
			</table>`;
		}

		case 'scores': {
			// Fixed-width cells in a table: Outlook honours table widths where it ignores
			// flex/inline-block. Each cell is 40px + 2px border + 4px padding = 46px, so
			// six are 276px — inside the 280px content column a 360px phone leaves once
			// the outer (24px) and card (56px) padding are taken off.
			const CELL = 46;
			const cells = block.urls
				.map((url, score) => {
					const href = safeUrl(url);
					const inner = `<span style="display:block;width:40px;line-height:42px;font-size:17px;font-weight:600;text-align:center;color:${accent}">${score}</span>`;
					return `<td style="padding:0 2px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border:1px solid ${accent};border-radius:4px;background:${PAPER}">${
						href ? `<a href="${esc(href)}" style="display:block;text-decoration:none">${inner}</a>` : inner
					}</td></tr></table></td>`;
				})
				.join('');
			return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 6px">
				<tr>${cells}</tr>
			</table>
			<table role="presentation" width="${block.urls.length * CELL}" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
				<tr>
					<td style="font-size:12px;color:${MUTED};text-align:left">${esc(block.lowLabel)}</td>
					<td style="font-size:12px;color:${MUTED};text-align:right">${esc(block.highLabel)}</td>
				</tr>
			</table>`;
		}
	}
}

function renderBlockText(block: EmailBlock): string | null {
	switch (block.type) {
		case 'text':
			return block.text;
		case 'note':
			return block.text;
		case 'divider':
			return '---';
		case 'details':
			// Aligned labels read as a summary rather than a run-on paragraph.
			return block.rows.map(([label, value]) => `  ${label.padEnd(12)} ${value}`).join('\n');
		case 'panel':
			return block.title ? `${block.title}\n${block.text}` : block.text;
		case 'button': {
			const href = safeUrl(block.url);
			return href ? `${block.label}: ${href}` : null;
		}
		case 'scores': {
			const href = safeUrl(block.textUrl);
			return href ? `Score your visit (${block.lowLabel} to ${block.highLabel}): ${href}` : null;
		}
	}
}

/**
 * Render one email to html + text.
 *
 * The two are generated from the same block tree, so they can't disagree about
 * what the message actually says — which is the failure mode of maintaining a
 * text version by hand.
 */
export function renderEmail(content: EmailContent): RenderedEmail {
	const brand = getBrand(content.brandId);
	const accent = ACCENT[content.brandId];

	const bodyHtml = content.blocks.map((b) => renderBlockHtml(b, accent)).join('\n');

	const footerHref = content.footer?.linkUrl ? safeUrl(content.footer.linkUrl) : null;
	// The default line is kept as literal HTML so every existing email's markup is
	// unchanged; only a caller-supplied footer goes through esc().
	const footerHtml = content.footer
		? `${esc(content.footer.text)}${
				footerHref && content.footer.linkLabel
					? ` <a href="${esc(footerHref)}" style="color:${FAINT}">${esc(content.footer.linkLabel)}</a>`
					: ''
			}`
		: "You're receiving this because of a booking made with us. It isn't marketing, so there's nothing to unsubscribe from.";

	const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${OUTER};-webkit-font-smoothing:antialiased">
<!-- Preheader: shown in the inbox list beside the subject, hidden in the body.
     The trailing entities stop clients pulling the next line of real copy in after it. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(content.preheader)}&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;&#8199;&#65279;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${OUTER}">
	<tr><td align="center" style="padding:24px 12px">
		<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${PAPER};border-radius:6px;overflow:hidden">
			<tr><td style="height:4px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>
			<tr><td style="padding:28px 28px 8px">
				<p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${MUTED}">${esc(brand.name)}</p>
				<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:400;color:${INK}">${esc(content.heading)}</h1>
			</td></tr>
			<tr><td style="padding:0 28px 8px;font-family:Arial,Helvetica,sans-serif">
				${bodyHtml}
			</td></tr>
			<tr><td style="padding:8px 28px 28px">
				<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
					<tr><td style="border-top:1px solid ${RULE};padding-top:16px">
						<p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:${FAINT};font-family:Arial,Helvetica,sans-serif">
							${esc(brand.name)} · ${esc(brand.address.line1)}, ${esc(brand.address.city)} ${esc(brand.address.postcode)}
						</p>
						<p style="margin:0;font-size:12px;line-height:1.6;color:${FAINT};font-family:Arial,Helvetica,sans-serif">
							${esc(brand.phone)} · <a href="mailto:${esc(brand.email)}" style="color:${FAINT}">${esc(brand.email)}</a>
						</p>
						<p style="margin:10px 0 0;font-size:11px;line-height:1.5;color:${FAINT};font-family:Arial,Helvetica,sans-serif">
							${footerHtml}
						</p>
					</td></tr>
				</table>
			</td></tr>
		</table>
	</td></tr>
</table>
</body></html>`;

	const textBlocks = content.blocks
		.map(renderBlockText)
		.filter((t): t is string => Boolean(t))
		.join('\n\n');

	const text = [
		brand.name.toUpperCase(),
		'',
		content.heading,
		'',
		textBlocks,
		'',
		'--',
		`${brand.name} · ${brand.address.line1}, ${brand.address.city} ${brand.address.postcode}`,
		`${brand.phone} · ${brand.email}`,
		'',
		content.footer
			? [content.footer.text, footerHref && content.footer.linkLabel ? `${content.footer.linkLabel}: ${footerHref}` : '']
					.filter(Boolean)
					.join('\n')
			: "You're receiving this because of a booking made with us."
	].join('\n');

	return { html, text };
}
