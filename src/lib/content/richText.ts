// Tiny, XSS-safe inline-emphasis parser for editable editorial copy.
//
// Staff type plain text with a lightweight convention instead of raw HTML:
//   *word*  -> <em>word</em>   (italic emphasis)
//   _word_  -> <u>word</u>     (underline)
// Everything else is plain text. We render the parsed segments through normal
// Svelte text/elements (NOT {@html}), so nothing the editor types can inject
// markup — the worst case is a literal asterisk showing through.
//
// `~` marks a non-breaking space (renders  ) so staff can keep phrases like
// "the~robata grill" from breaking awkwardly, mirroring the original &nbsp;.

export type RichSegment = { text: string; em?: boolean; u?: boolean; href?: string };

const TOKEN = /(\*[^*]+\*|_[^_]+_)/g;
// Markdown-style links: [label](/path) — the one piece of structure page copy
// genuinely needs, since sentences like "please use the bookings page" carry a
// link mid-paragraph and there's nowhere else to put it.
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/**
 * Accept a destination only if it's unambiguously safe.
 *
 * An internal path, or an explicit http/https/mailto/tel URL. Everything else —
 * `javascript:`, `data:`, protocol-relative `//evil.com`, anything exotic — is
 * rejected and the link degrades to plain text. Staff copy is trusted-ish, but
 * this is the one field where a paste could carry a scheme, so allow-list.
 */
function safeHref(raw: string): string | undefined {
	const url = raw.trim();
	if (!url || url.startsWith('//')) return undefined;
	if (url.startsWith('/') || url.startsWith('#')) return url;
	return /^(https?:|mailto:|tel:)/i.test(url) ? url : undefined;
}

/** Split a run on [label](href) links, dropping unsafe destinations to text. */
function linkSegments(segs: RichSegment[]): RichSegment[] {
	const out: RichSegment[] = [];
	for (const seg of segs) {
		if (seg.em || seg.u || seg.href) {
			out.push(seg);
			continue;
		}
		let last = 0;
		for (const m of seg.text.matchAll(LINK)) {
			const idx = m.index ?? 0;
			if (idx > last) out.push({ text: seg.text.slice(last, idx) });
			const href = safeHref(m[2]);
			out.push(href ? { text: m[1], href } : { text: m[1] });
			last = idx + m[0].length;
		}
		if (last === 0) out.push(seg);
		else if (last < seg.text.length) out.push({ text: seg.text.slice(last) });
	}
	return out;
}
// Deliberately conservative: only what we actually need to re-link in editable
// copy (contact email addresses). No scheme is ever taken from the input, so a
// segment's href can only ever be a mailto: we built ourselves.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Turn bare email addresses in a parsed run into mailto: link segments.
 *
 * The Privacy copy used to carry hand-written <a href="mailto:{brand.email}">
 * markup. Now that the same copy is staff-editable plain text we can't accept
 * HTML from it (XSS), so the address is detected here and the anchor is built by
 * us — the editor supplies only the visible text.
 */
function autolinkSegments(segs: RichSegment[]): RichSegment[] {
	const out: RichSegment[] = [];
	for (const seg of segs) {
		// Never rewrite inside an already-styled or already-linked run.
		if (seg.em || seg.u || seg.href) {
			out.push(seg);
			continue;
		}
		let last = 0;
		for (const m of seg.text.matchAll(EMAIL)) {
			const idx = m.index ?? 0;
			if (idx > last) out.push({ text: seg.text.slice(last, idx) });
			out.push({ text: m[0], href: `mailto:${m[0]}` });
			last = idx + m[0].length;
		}
		if (last === 0) out.push(seg);
		else if (last < seg.text.length) out.push({ text: seg.text.slice(last) });
	}
	return out;
}

/** Parse a marked string into styled segments (em / u / plain). */
export function parseRich(input: string): RichSegment[] {
	const src = (input ?? '').replace(/~/g, ' ');
	const out: RichSegment[] = [];
	let last = 0;
	for (const m of src.matchAll(TOKEN)) {
		const idx = m.index ?? 0;
		if (idx > last) out.push({ text: src.slice(last, idx) });
		const tok = m[0];
		const inner = tok.slice(1, -1);
		if (tok.startsWith('*')) out.push({ text: inner, em: true });
		else out.push({ text: inner, u: true });
		last = idx + tok.length;
	}
	if (last < src.length) out.push({ text: src.slice(last) });
	return out.length ? out : [{ text: src }];
}

/**
 * parseRich + [label](href) links + bare-email autolinking. Opt-in (rather than
 * folded into parseRich) so the existing hero/editorial callers keep their
 * current output untouched.
 */
export function parseRichLinked(input: string): RichSegment[] {
	return autolinkSegments(linkSegments(parseRich(input)));
}
