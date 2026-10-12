<script lang="ts">
	// Private hire / functions + enquiry form, themed per brand. Reuses the
	// gallery as an interior/events strip to sell the room.
	import type { Brand } from '$lib/data/brand';
	import type { GalleryImage } from '$lib/data/gallery';
	import type { PagesContent, BrandInfoContent } from '$lib/content/schema';
	import { getPagesDefaults, fillTokens, tokenSource } from '$lib/data/pages';
	import Gallery from './Gallery.svelte';
	import Reveal from './Reveal.svelte';
	import RichText from './RichText.svelte';

	// `copy` is the editable override from Content → Pages (including the occasion
	// list, which drives both the pills and the enquiry-form dropdown); `images`
	// is the editable gallery, which this room strip used to bypass.
	let {
		brand,
		copy,
		brandInfo,
		images
	}: {
		brand: Brand;
		copy?: PagesContent['parties'];
		brandInfo?: BrandInfoContent;
		images?: GalleryImage[];
	} = $props();

	const c = $derived(copy ?? getPagesDefaults(brand.id).parties);
	const tok = $derived(tokenSource(brand, brandInfo));
	const fill = (s: string) => fillTokens(s, tok);

	let form = $state({ name: '', email: '', phone: '', date: '', size: '', occasion: '', message: '' });
	let submitted = $state(false);
	let sending = $state(false);
	let sendError = $state('');
	// Honeypot — see the note on the markup below.
	let website = $state('');

	// Fall back to the defaults if an override saved an empty list, so the enquiry
	// form can never end up with a dropdown of nothing.
	const occasions = $derived(
		c.occasions.length ? c.occasions : getPagesDefaults(brand.id).parties.occasions
	);

	/**
	 * Send the enquiry and only THEN show the thank-you.
	 *
	 * This used to be a stub: preventDefault, `submitted = true`, and a TODO. It
	 * displayed "your enquiry is in — our functions team will be in touch" while
	 * sending precisely nothing, so every function enquiry made through this page
	 * was silently discarded. It now goes to /api/contact (kind: 'parties'), the
	 * same endpoint the contact form uses, and lands in Guests → Enquiries.
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
					kind: 'parties',
					name: form.name,
					email: form.email,
					phone: form.phone,
					date: form.date,
					partySize: form.size,
					occasion: form.occasion,
					message: form.message,
					website
				})
			});
			if (!res.ok) {
				const b = await res.json().catch(() => null);
				sendError =
					(b && typeof b.message === 'string' && b.message) ||
					`Sorry — your enquiry could not be sent. Please call us on ${tok.phone}.`;
				return;
			}
			submitted = true;
		} catch {
			sendError = `Sorry — your enquiry could not be sent. Please call us on ${tok.phone}.`;
		} finally {
			sending = false;
		}
	}
</script>

<section class="parties" data-brand={brand.id}>
	<header class="head">
		<h1>{fill(c.title)}</h1>
		<p class="lead">{fill(c.lead)}</p>
	</header>

	<Reveal>
		<div class="intro">
			<p><RichText text={fill(c.intro)} autolink /></p>
			<!-- Private-hire leaflet. Only rendered once a PDF has been set in
			     Content → Pages → Parties, so there is never a button pointing at a
			     file that doesn't exist. -->
			{#if c.leafletUrl}
				<a class="leaflet" href={c.leafletUrl} target="_blank" rel="noopener noreferrer">
					{c.leafletLabel || 'Download our private hire leaflet'}
					<span aria-hidden="true">↓</span>
				</a>
			{/if}
		</div>
	</Reveal>

	<!-- room/events strip -->
	<div class="strip">
		<Gallery brandId={brand.id} {images} max={6} />
	</div>

	<div class="occasions">
		{#each occasions as o}
			<span class="pill">{o}</span>
		{/each}
	</div>

	<!-- ENQUIRY FORM -->
	<div class="enquiry" id="enquire">
		<h2>{fill(c.enquiryHeading)}</h2>
		{#if submitted}
			<p class="thanks"><RichText text={fill(c.thanks)} autolink /></p>
		{:else}
			<form onsubmit={submit}>
				<div class="row">
					<label>Name<input type="text" bind:value={form.name} required /></label>
					<label>Email<input type="email" bind:value={form.email} required /></label>
				</div>
				<div class="row">
					<label>Phone<input type="tel" bind:value={form.phone} /></label>
					<label>Preferred date<input type="date" bind:value={form.date} /></label>
				</div>
				<div class="row">
					<label>Party size<input type="number" min="1" bind:value={form.size} /></label>
					<label>
						Occasion
						<select bind:value={form.occasion}>
							<option value="" disabled selected>Choose…</option>
							{#each occasions as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
				</div>
				<label>Tell us more<textarea rows="4" bind:value={form.message}></textarea></label>
				<!-- Honeypot — off-screen rather than display:none, which bots skip. Kept
				     out of the tab order and the accessibility tree. -->
				<div class="hp" aria-hidden="true">
					<label>
						Website
						<input type="text" bind:value={website} tabindex="-1" autocomplete="off" />
					</label>
				</div>
				<button type="submit" disabled={sending}>
					{sending ? 'Sending…' : 'Send Enquiry'}
				</button>
				{#if sendError}
					<p class="senderr" role="alert">{sendError}</p>
				{/if}
			</form>
		{/if}
		<p class="alt"><RichText text={fill(c.altLine)} autolink /></p>
	</div>
</section>

<style>
	.parties {
		max-width: 1100px;
		margin: 0 auto;
		padding: 3rem 1.6rem 5rem;
		color: var(--ink);
		font-family: var(--font-body);
	}
	.head {
		text-align: center;
		margin-bottom: 2rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.6rem, 6vw, 4.2rem);
		margin: 0.3rem 0 0.3rem;
		font-weight: 500;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0;
	}
	.intro {
		max-width: 720px;
		margin: 0 auto 2.4rem;
		text-align: center;
	}
	.intro p {
		font-size: 1.2rem;
		line-height: 1.7;
		color: var(--ink-soft);
		margin: 0;
	}
	button[disabled] {
		opacity: 0.6;
		cursor: default;
	}
	.senderr {
		font-size: 0.9rem;
		color: #e2726a;
		margin: 0.6rem 0 0;
	}
	.hp {
		position: absolute;
		left: -9999px;
		width: 1px;
		height: 1px;
		overflow: hidden;
	}
	.leaflet {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.3rem;
		padding: 0.75rem 1.5rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		font-family: var(--font-sans, var(--font-body));
		font-size: 0.75rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
		transition:
			background 0.22s ease,
			color 0.22s ease;
	}
	.leaflet:hover {
		background: var(--accent);
		color: var(--bg);
	}
	.strip {
		margin: 0 -0.4rem 2.4rem;
	}
	.occasions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 3rem;
	}
	.pill {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--ink-soft);
	}
	.enquiry {
		max-width: 720px;
		margin: 0 auto;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 2.4rem 2rem;
	}
	.enquiry h2 {
		margin: 0 0 1.4rem;
		font-size: 1.8rem;
		color: var(--accent);
		font-weight: 500;
		text-align: center;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
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
		font-size: 0.68rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	input,
	select,
	textarea {
		font-family: var(--font-serif);
		font-size: 1.05rem;
		padding: 0.7rem 0.8rem;
		border-radius: 4px;
		border: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
		color: var(--ink);
		resize: vertical;
	}
	input:focus,
	select:focus,
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	button {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.15rem;
		padding: 0.9rem 1.4rem;
		border-radius: 4px;
		border: 0;
		background: var(--accent);
		color: var(--bg);
		cursor: pointer;
		transition: filter 0.2s ease;
	}
	button:hover {
		filter: brightness(1.06);
	}
	.thanks {
		font-size: 1.1rem;
		line-height: 1.6;
		color: var(--ink-soft);
		text-align: center;
	}
	.alt {
		margin: 1.4rem 0 0;
		text-align: center;
		font-size: 0.95rem;
		color: var(--ink-soft);
	}
	.alt a,
	.thanks a {
		color: var(--accent);
	}
	@media (max-width: 640px) {
		.row {
			grid-template-columns: 1fr;
		}
	}
</style>
