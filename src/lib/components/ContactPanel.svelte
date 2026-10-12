<script lang="ts">
	// Contact — form + details + map. Map uses the keyless Google Maps
	// `output=embed` iframe (no API key / Cloud Console). Form is a styled stub
	// for /api/contact (Resend) — that endpoint does not exist yet.
	import type { Brand } from '$lib/data/brand';
	import type { PagesContent, BrandInfoContent } from '$lib/content/schema';
	import { getPagesDefaults, fillTokens, tokenSource } from '$lib/data/pages';
	import RichText from './RichText.svelte';

	// `copy` is the editable override from Content → Pages; `brandInfo` supplies
	// the live phone/email/address, both for the details list and for the
	// `{token}` placeholders in the copy.
	let {
		brand,
		copy,
		brandInfo
	}: { brand: Brand; copy?: PagesContent['contact']; brandInfo?: BrandInfoContent } = $props();

	const c = $derived(copy ?? getPagesDefaults(brand.id).contact);
	const tok = $derived(tokenSource(brand, brandInfo));
	const fill = (s: string) => fillTokens(s, tok);

	let form = $state({ name: '', email: '', subject: '', message: '' });
	let submitted = $state(false);
	let sending = $state(false);
	let sendError = $state('');
	// Honeypot. Hidden from people (and from screen readers via aria-hidden +
	// tabindex="-1"), so anything in it came from a bot; the endpoint drops those.
	let website = $state('');

	// Editable (Content → Pages) so a move or a second site needs no code change;
	// falls back to the Benton, NE12 8AE embed.
	const mapSrc = $derived(c.mapEmbedUrl || getPagesDefaults(brand.id).contact.mapEmbedUrl);
	const mapLink = $derived(c.mapLinkUrl || getPagesDefaults(brand.id).contact.mapLinkUrl);

	/**
	 * POST the message and only THEN show the thank-you.
	 *
	 * This used to set `submitted = true` unconditionally without sending
	 * anything, so every enquiry was silently discarded behind a confirmation
	 * that said it was on its way. The thank-you now waits for a 2xx, and a
	 * failure says so and leaves the typed message in the box to retry.
	 */
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (sending) return;
		sending = true;
		sendError = '';
		try {
			const res = await fetch('/api/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					brand: brand.id,
					name: form.name,
					email: form.email,
					subject: form.subject,
					message: form.message,
					website
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				sendError =
					(body && typeof body.message === 'string' && body.message) ||
					`Sorry — your message could not be sent. Please call us on ${tok.phone}.`;
				return;
			}
			submitted = true;
		} catch {
			sendError = `Sorry — your message could not be sent. Please call us on ${tok.phone}.`;
		} finally {
			sending = false;
		}
	}
</script>

<section class="contact" data-brand={brand.id}>
	<header class="head">
		<h1>{fill(c.title)}</h1>
		<p class="lead">{fill(c.lead)}</p>
	</header>

	<div class="grid">
		<!-- DETAILS + FORM -->
		<div class="left">
			<div class="details">
				<div class="detail">
					<span class="k">Call</span>
					<a href="tel:{tok.phone.replace(/\s/g, '')}">{tok.phone}</a>
				</div>
				<div class="detail">
					<span class="k">Email</span>
					<a href="mailto:{tok.email}">{tok.email}</a>
				</div>
				<div class="detail">
					<span class="k">Find us</span>
					<!-- A link, like Call and Email: on a phone the address is what people tap
					     for directions, and the only route to the map used to be a 15px-tall
					     caption under the whole form. -->
					<a href={mapLink} target="_blank" rel="noopener noreferrer">
						{tok.address.line1}, {tok.address.city}, {tok.address.postcode}
					</a>
				</div>
				<div class="detail">
					<span class="k">Metro</span>
					<span>{tok.address.metro}</span>
				</div>
			</div>

			{#if submitted}
				<p class="thanks"><RichText text={fill(c.thanks)} /></p>
			{:else}
				<form onsubmit={submit}>
					<div class="row">
						<label>Your name<input type="text" bind:value={form.name} required /></label>
						<label>Your email<input type="email" bind:value={form.email} required /></label>
					</div>
					<label>Subject<input type="text" bind:value={form.subject} /></label>
					<label>Message<textarea rows="4" bind:value={form.message} required></textarea></label>
					<!-- Honeypot — off-screen, not hidden with display:none (bots skip those). -->
					<div class="hp" aria-hidden="true">
						<label>
							Website
							<input type="text" bind:value={website} tabindex="-1" autocomplete="off" />
						</label>
					</div>
					<button type="submit" disabled={sending}>
						{sending ? 'Sending…' : 'Send Message'}
					</button>
					{#if sendError}
						<p class="senderr" role="alert">{sendError}</p>
					{/if}
					<p class="note"><RichText text={fill(c.formNote)} autolink /></p>
				</form>
			{/if}
		</div>

		<!-- MAP -->
		<div class="map">
			<iframe title="Map to {brand.name}" src={mapSrc} loading="lazy"></iframe>
			<a class="bigmap" href={mapLink} target="_blank" rel="noopener noreferrer">
				Open larger map ›
			</a>
		</div>
	</div>
</section>

<style>
	.contact {
		max-width: 1100px;
		margin: 0 auto;
		padding: 3rem 1.6rem 5rem;
		color: var(--ink);
		font-family: var(--font-body);
	}
	.head {
		text-align: center;
		margin-bottom: 2.6rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.6rem, 6vw, 4.2rem);
		margin: 0.3rem 0 0.4rem;
		font-weight: 500;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.6rem;
		align-items: start;
	}
	.details {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		margin-bottom: 1.6rem;
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.detail .k {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.detail a,
	.detail span:not(.k) {
		color: var(--ink-soft);
		text-decoration: none;
		font-size: 1.02rem;
	}
	.detail a:hover {
		color: var(--accent);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 1.8rem 1.6rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-family: var(--font-sans);
		font-size: 0.66rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	input,
	textarea {
		font-family: var(--font-body);
		/* Without this a bare input's ~195px intrinsic min-width stops the two-up
		   .row grid ever collapsing, which pushed the form off the right of a phone. */
		min-width: 0;
		font-size: 1.05rem;
		padding: 0.7rem 0.8rem;
		border-radius: 4px;
		border: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
		color: var(--ink);
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	button {
		font-family: var(--font-body);
		font-size: 1.15rem;
		padding: 0.85rem 1.4rem;
		border-radius: 4px;
		border: 0;
		background: var(--accent);
		color: var(--bg);
		cursor: pointer;
	}
	/* The italic is an Asia flourish; Space Grotesk has no true italic, so Fusion
	   would get a synthesised slant. */
	.contact[data-brand='asia'] button {
		font-style: italic;
	}
	.note {
		font-size: 0.9rem;
		font-style: italic;
		color: var(--ink-faint);
		margin: 0;
	}
	button[disabled] {
		opacity: 0.6;
		cursor: default;
	}
	.senderr {
		font-size: 0.9rem;
		color: #e2726a;
		margin: 0;
	}
	/* Off-screen rather than display:none / hidden — a bot that skips hidden
	   inputs would sail past the trap. Kept out of the tab order and the
	   accessibility tree by tabindex="-1" / aria-hidden on the wrapper. */
	.hp {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	/* The link is rendered by <RichText>, a child component, so Svelte's scoped
	   selector never reached it and it fell back to the UA's default blue.
	   :global crosses the component boundary. */
	.note :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}
	.note :global(a:hover) {
		color: var(--ink);
	}
	.thanks :global(a) {
		color: var(--accent);
	}
	.thanks {
		font-size: 1.1rem;
		color: var(--ink-soft);
	}
	.map {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.map iframe {
		width: 100%;
		height: 420px;
		border: 1px solid var(--line);
		border-radius: 10px;
		filter: var(--map-filter, none);
	}
	.bigmap {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
		align-self: flex-end;
	}
	@media (max-width: 760px) {
		/* Tighter top and bottom: 3rem under the fixed bar and 5rem above the
		   footer's own 4rem left a dead band at both ends of a phone screen. */
		.contact {
			padding: 2rem 1.25rem 3.5rem;
			/* Google's map is a near-white tile and, stacked full-width between the
			   details and the form, the brightest thing on a dark phone screen. A
			   light dim takes the glare off; streets, labels and the red pin read
			   exactly as before. (Deliberately not an invert-to-dark: that turns the
			   satellite thumbnail into a negative and washes the pin out.) */
			--map-filter: grayscale(0.3) brightness(0.86) contrast(1.04);
		}
		.head {
			margin-bottom: 1.8rem;
		}
		/* Stops the postcode's second half dropping onto a line of its own. */
		.lead,
		.note {
			text-wrap: balance;
		}
		/* "Geisha Fusion · Front Street, Benton, NE12 8AE" is 3px too wide for a
		   360px screen at 16px, and balanced it broke as "…· Front / Street…".
		   Scaled a hair with the width it holds one line down to 320. */
		.lead {
			font-size: clamp(0.85rem, 4.2vw, 1rem);
		}
		.grid {
			grid-template-columns: 1fr;
			gap: 1.4rem;
		}
		/* One column: details → map → form. Stacked in source order the map sat
		   below the whole form, three screens down, and on a phone this page is
		   for calling and getting directions. `display: contents` lifts the
		   details and the form into the grid so the map can sit between them. */
		.left {
			display: contents;
		}
		.details {
			order: 1;
			margin-bottom: 0;
		}
		.map {
			order: 2;
		}
		form,
		.thanks {
			order: 3;
		}
		.map iframe {
			height: 260px;
			/* Its border sat outside `width: 100%`, so the map ran a pixel past the
			   button beneath it. */
			box-sizing: border-box;
		}
		/* Was an 11px caption 15px tall, right-aligned — not a thumb target. */
		.bigmap {
			align-self: stretch;
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 46px;
			border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
			border-radius: 4px;
			font-size: 0.75rem;
		}
	}
	/* Phones: the two-up details list and the two-up name/email row were the only
	   things left at 1fr 1fr, and `1fr` floors at min-content — an email address
	   and an <input> are both wider than half a 360px screen, so the page grew a
	   horizontal scrollbar and the email address / Send Message were cut off. */
	@media (max-width: 560px) {
		.details,
		.row {
			grid-template-columns: 1fr;
		}
		/* The details become ruled rows. Call, Email and Find us are links, and as
		   grey 16px text they read as plain copy with a 23px-tall hit area; here
		   the whole row is the target (the ::before), in full ink, with a chevron
		   to say it goes somewhere. Metro is not a link and stays as it was. */
		.details {
			gap: 0;
			border-top: 1px solid var(--line);
		}
		.detail {
			position: relative;
			gap: 0.3rem;
			padding: 0.8rem 0;
			border-bottom: 1px solid var(--line);
		}
		.detail .k {
			font-size: 0.75rem;
		}
		.detail a {
			color: var(--ink);
			font-size: 1.15rem;
			padding-right: 1.6rem;
		}
		.detail a::before {
			content: '';
			position: absolute;
			inset: 0;
		}
		.detail a::after {
			content: '›';
			position: absolute;
			right: 0.15rem;
			top: 50%;
			transform: translateY(-50%);
			color: var(--accent);
			font-size: 1.5rem;
			line-height: 1;
		}
		/* 1.6rem of card padding inside a 1.6rem gutter left 270px inputs. */
		form {
			padding: 1.4rem 1.15rem 1.5rem;
		}
		/* 10.5px caps were under the legible floor on a phone. */
		label {
			font-size: 0.75rem;
			letter-spacing: 0.14em;
		}
	}
	/* Long addresses must wrap rather than push the column wide. */
	.detail a,
	.detail span:not(.k) {
		overflow-wrap: anywhere;
	}
</style>
