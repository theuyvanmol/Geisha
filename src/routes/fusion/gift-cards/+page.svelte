<script lang="ts">
	// ===== GIFT VOUCHERS — GEISHA FUSION =====
	//
	// Bespoke page, built to the same standard as the Asia one (asia/gift-cards)
	// rather than the thin shared <GiftCardPanel> this route used to render. Same
	// four-part shape — opening / choose / how it works / the detail — because that
	// order is what makes the page work, and the same motion pattern (staged entry,
	// then an IntersectionObserver tagging [data-reveal] nodes).
	//
	// It is NOT the Asia page recoloured, which is the trap this site keeps falling
	// into. The differences are structural:
	//   · EMBER ON GREEN, not gold on ink. The ground is Fusion's own green-black and
	//     the accent is the orange from the paint streaks in the hero artwork. Asia's
	//     page is a neutral near-black under antique gold with a pink action colour.
	//   · CONCENTRIC RINGS, not seigaiha. The rings are Fusion's motif (the hero,
	//     story and menu bands are all built on them); the wave pattern is Asia's.
	//   · The opening art is the A4 GIFT CARD POSTER, portrait, hung as a print —
	//     Asia's is a landscape photograph of the card set, tilted in 3D.
	//
	// The commerce is unchanged and identical to Asia's: our own denomination picker
	// hands off to Gift Up's HOSTED checkout with the chosen brand+amount voucher
	// pre-selected, and Gift Up takes the payment, issues, emails and redeems it
	// (see $lib/data/giftup.ts). The CTA is a real <a href> rather than a scripted
	// window.location so it can be opened in a new tab, middle-clicked, and read by
	// assistive tech as a link.
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { giftUpAmounts, giftUpProductId, giftUpCheckoutUrl } from '$lib/data/giftup';
	import ChristmasVoucher from '$lib/components/ChristmasVoucher.svelte';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const brand = getBrand('fusion');

	/** The printed A4 gift-card banner, served from static/. Shown as the opening
	    art and linked in full so it can be read, saved or printed. */
	const POSTER_PDF = '/geisha_gift_card_a4_banner.pdf';

	const amounts = giftUpAmounts(brand.id);
	let amount = $state<number>(amounts.includes(50) ? 50 : (amounts[0] ?? 0));
	// The "For Christmas" options. They are the SAME Gift Up vouchers as the plain
	// amounts (the account sells nothing else — see $lib/data/giftup.ts); picking one
	// only swaps the preview for the Christmas card and the wording on the button.
	const xmasAmounts = amounts.filter((a) => a >= 50);
	let festive = $state(false);

	const checkoutUrl = $derived(
		data.giftUpSiteId ? giftUpCheckoutUrl(data.giftUpSiteId, giftUpProductId(brand.id, amount)) : ''
	);

	const tel = brand.phone.replace(/\s/g, '');

	// ===== MOTION =====
	// The house pattern: a staged entry flipped one frame after mount, then one
	// IntersectionObserver tagging [data-reveal] nodes with `data-in` as they scroll
	// in. All the movement is CSS keyed off those attributes.
	let entered = $state(false);

	onMount(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		let io: IntersectionObserver | undefined;
		const reveals = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
		if (reduce) {
			for (const el of reveals) el.setAttribute('data-in', '');
		} else {
			io = new IntersectionObserver(
				(entries) => {
					for (const e of entries) {
						if (e.isIntersecting) {
							e.target.setAttribute('data-in', '');
							io?.unobserve(e.target);
						}
					}
				},
				{ threshold: 0.16, rootMargin: '0px 0px -8% 0px' }
			);
			for (const el of reveals) io.observe(el);
		}

		if (reduce) {
			entered = true;
			return () => io?.disconnect();
		}
		// Double rAF so the off-state paints once before the transition runs — a
		// single frame can be coalesced with the initial paint and skip it entirely.
		let id2 = 0;
		const id1 = requestAnimationFrame(() => {
			id2 = requestAnimationFrame(() => (entered = true));
		});
		return () => {
			cancelAnimationFrame(id1);
			cancelAnimationFrame(id2);
			io?.disconnect();
		};
	});
</script>

<Seo
	title="Gift Vouchers — Geisha Fusion"
	description="Geisha Fusion gift vouchers from £25. Sent by email in minutes, redeemable against food and drink at Geisha Fusion, Benton."
/>

<div class="page" data-brand="fusion">
	<!-- ===== OPENING — copy left, the printed A4 poster hung on the right ===== -->
	<section class="opening" class:enter={entered}>
		<div class="ember" aria-hidden="true"></div>
		<div class="rings" aria-hidden="true">
			<span></span><span></span><span></span>
		</div>

		<div class="opening-inner">
			<div class="opening-copy">
				<span class="eyebrow"><span class="rule"></span>Geisha Fusion</span>
				<h1>
					<span class="ht-line"><span class="ht-in">The gift of</span></span>
					<span class="ht-line"><span class="ht-in"><em>Fusion</em></span></span>
				</h1>
				<p class="lede">
					Burgers, curry, stone-baked pizza and a proper Sunday roast — a voucher for the lot.
					Choose an amount, add a message, and it lands in their inbox within minutes.
				</p>
				<div class="denoms" aria-hidden="true">
					{#each amounts as a, i}
						{#if i > 0}<span class="pip"></span>{/if}
						<span>£{a}</span>
					{/each}
				</div>
				<div class="actions">
					<a class="btn btn-solid" href="#choose">Choose an amount</a>
					<a class="btn" href="tel:{tel}">Buy in the restaurant</a>
				</div>
			</div>

			<!-- The printed banner, hung like a framed print. The whole thing is the
			     link to the PDF (not just the caption) — it's the obvious thing to
			     click, and a poster you can't open at full size is a dead end. -->
			<figure class="poster">
				<a
					class="poster-link"
					href={POSTER_PDF}
					target="_blank"
					rel="noopener"
					aria-label="Open the Geisha gift card poster as a PDF, in a new tab"
				>
					<picture>
						<source
							type="image/avif"
							srcset="/art/gift-card-banner-800.avif 800w, /art/gift-card-banner-1280.avif 1280w"
							sizes="(max-width: 1020px) 84vw, 40vw"
						/>
						<source
							type="image/webp"
							srcset="/art/gift-card-banner-800.webp 800w, /art/gift-card-banner-1280.webp 1280w"
							sizes="(max-width: 1020px) 84vw, 40vw"
						/>
						<img
							src="/art/gift-card-banner-1280.webp"
							width="1280"
							height="1811"
							alt="Geisha gift card poster — “Giving the perfect gift”. Vouchers can be purchased for £25, £50 or £100 in our restaurants and are also available online for instant delivery."
							fetchpriority="high"
						/>
					</picture>
					<span class="poster-cue">
						<span class="poster-cue-i" aria-hidden="true"></span>
						Open the full poster (PDF)
					</span>
				</a>
			</figure>
		</div>
	</section>

	<!-- ===== CHOOSE — denomination picker + a live voucher preview ===== -->
	<section class="choose" id="choose">
		<div class="section-head" data-reveal="rise">
			<span class="eyebrow"><span class="rule"></span>Step one</span>
			<h2>Choose an amount</h2>
		</div>

		<div class="choose-grid">
			<div class="picker" data-reveal="col-l">
				<div class="amounts" role="radiogroup" aria-label="Voucher amount">
					{#each amounts as a}
						<button
							type="button"
							role="radio"
							aria-checked={!festive && amount === a}
							class="amt"
							class:on={!festive && amount === a}
							onclick={() => {
								amount = a;
								festive = false;
							}}
						>
							<span class="amt-value">£{a}</span>
						</button>
					{/each}
					<!-- For Christmas: the same vouchers, shown on the Christmas card. -->
					{#if xmasAmounts.length}
						<span class="xmas-head" aria-hidden="true">For Christmas</span>
						{#each xmasAmounts as a}
							<button
								type="button"
								role="radio"
								aria-checked={festive && amount === a}
								class="amt amt-xmas"
								class:on={festive && amount === a}
								onclick={() => {
									amount = a;
									festive = true;
								}}
							>
								<span class="amt-value">£{a}</span>
								<span class="amt-note">Christmas voucher</span>
							</button>
						{/each}
					{/if}
				</div>

				{#if checkoutUrl}
					<a class="btn btn-solid buy" href={checkoutUrl}>
						Buy a £{amount} {festive ? 'Christmas ' : ''}voucher
					</a>
				{:else}
					<!-- No Gift Up account configured (there is a default, so this shouldn't
					     happen) — never leave a dead button: send them to the phone. -->
					<a class="btn btn-solid buy" href="tel:{tel}">
						Call {brand.phone} to buy
					</a>
				{/if}

				<p class="fine">
					Payment is handled securely by Gift Up. Vouchers are redeemable against food and drink at {brand.name},
					Benton. Prefer a different amount, or a printed card to hand over? Call us on
					<a href="tel:{tel}">{brand.phone}</a>.
				</p>
			</div>

			<!-- The voucher as it reads — the card from the poster, in markup, so the
			     chosen amount is shown before they ever reach the checkout. -->
			<div class="preview-wrap" data-reveal="col-r">
				{#if festive}
					<ChristmasVoucher {brand} {amount} />
				{:else}
					<div class="voucher">
						<div class="v-rings" aria-hidden="true"></div>
						<div class="v-ember" aria-hidden="true"></div>
						<!-- Intrinsic size is the Fusion wordmark's own 900x301, NOT Asia's
						     1554x461 — a mismatched pair here reserves the wrong box and the
						     card jumps as the image lands. -->
						<img class="v-mark" src="/geisha-fusion-wordmark.png" alt="" width="900" height="301" />
						<!-- Keyed so the settle animation actually replays on each pick — a CSS
						     animation on a surviving element only ever runs once. -->
						{#key amount}
							<div class="v-amount">
								<span class="v-cur">£</span>{amount}
							</div>
						{/key}
						<div class="v-foot">
							<span>Gift Voucher</span>
							<span>{brand.name}</span>
						</div>
						<span class="v-corner v-tl" aria-hidden="true"></span>
						<span class="v-corner v-tr" aria-hidden="true"></span>
					</div>
				{/if}
				<p class="v-caption">Sent by email, ready to print or forward.</p>
			</div>
		</div>
	</section>

	<!-- ===== HOW IT WORKS ===== -->
	<section class="steps">
		<div class="section-head" data-reveal="rise">
			<span class="eyebrow"><span class="rule"></span>How it works</span>
			<h2>Three steps, two minutes</h2>
		</div>

		<ol class="step-row">
			<li data-reveal="card">
				<span class="n">01</span>
				<h3>Pick the amount</h3>
				<p>£25, £50 or £100 — whatever suits the occasion.</p>
			</li>
			<li data-reveal="card" style="--rd: 0.08s">
				<span class="n">02</span>
				<h3>Add your message</h3>
				<p>Write a note and choose the day it should arrive — a birthday morning, say.</p>
			</li>
			<li data-reveal="card" style="--rd: 0.16s">
				<span class="n">03</span>
				<h3>They come and eat</h3>
				<p>The voucher is shown at the table and taken off the bill. Nothing to post.</p>
			</li>
		</ol>
	</section>

	<!-- ===== THE DETAIL ===== -->
	<section class="detail">
		<div class="detail-inner">
			<div class="detail-copy" data-reveal="rise">
				<span class="eyebrow"><span class="rule"></span>Good to know</span>
				<h2>The small print, plainly</h2>
				<ul class="facts">
					<li>Delivered by email within minutes of purchase — or on a date you choose.</li>
					<li>Redeemable against food and drink at {brand.name}, Front Street, Benton.</li>
					<li>Print it, forward it, or show it on a phone at the table.</li>
					<li>Any expiry date is printed on the voucher itself.</li>
					<li>Not exchangeable for cash, and change isn't given on the balance.</li>
				</ul>
			</div>

			<aside class="detail-call" data-reveal="rise" style="--rd: 0.1s">
				<h3>Buying for a group?</h3>
				<p>
					Corporate gifts, a round of thank-yous for a team, or a voucher for a big table — give us a
					ring and we'll sort it.
				</p>
				<a class="btn" href="tel:{tel}">{brand.phone}</a>
				<a class="quiet" href="mailto:{brand.email}">{brand.email}</a>
			</aside>
		</div>
	</section>

	<SiteFooter {brand} />
</div>

<style>
	/* No `background` here — see the note in fusion/+page.svelte. A ground set from a
	   route's `:global(body)` outlives that route and leaks across brands. */
	:global(body) {
		margin: 0;
		color: var(--ink, #f2ece0);
		font-family: var(--font-body, 'Jost', system-ui, sans-serif);
		font-feature-settings: 'liga', 'dlig';
	}

	.page {
		/* ===== EMBER ON GREEN =====
		   Fusion's ground is a deep GREEN-black and stays that way — the green is the
		   brand, and it's what tells this house apart from Asia's neutral near-black.
		   What this page pushes forward is the ORANGE in the hero artwork, laid over
		   that green as firelight: warm accents, warm washes, warm hairlines.

		   These are named --green* rather than --black* on purpose. They were briefly
		   near-blacks (#050607/#101315) and the green disappeared from the page
		   entirely; the names are now a reminder of which way this goes. */
		--green: #0a0d0b;
		--green-2: #0c1410;
		--char: #101a15;
		--char-2: #16241d;
		--orange: #e2762b;
		--orange-bright: #f79a4a;
		--orange-deep: #a8480f;
		--orange-glow: rgba(226, 118, 43, 0.42);
		--gold: #c98a4b;
		--gold-bright: #e8ab6b;
		--hair: rgba(226, 118, 43, 0.18);
		--hair-soft: rgba(242, 236, 224, 0.1);
		--ivory: #f2ece0;
		--muted: rgba(242, 236, 224, 0.66);
		--faint: rgba(242, 236, 224, 0.5);
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease-f: cubic-bezier(0.2, 0.8, 0.2, 1);

		/* Deliberately NOT the brand's --page-bg (a green-black gradient): this page
		   is ember on black, and the green ground fought the orange. */
		background: linear-gradient(to bottom, var(--green) 0%, var(--green-2) 48%, var(--green) 100%);
		color: var(--ivory);
		font-family: var(--body-f);
		overflow-x: clip;
	}

	/* ===== SHARED BITS ===== */
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--orange);
	}
	.eyebrow .rule {
		display: block;
		width: 34px;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--orange));
	}

	/* Buttons — the outline button fills with ember rising from the bottom edge, the
	   solid one drifts its gradient across; one specular sheen on both. ::before is
	   the ink, ::after the sheen, both under the label on z-index -1 inside the
	   button's own stacking context. */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-height: 48px;
		padding: 0.85rem 1.9rem;
		border: 1px solid var(--orange);
		color: var(--ivory);
		background: transparent;
		font-family: var(--body-f);
		font-size: 0.78rem;
		font-weight: 400;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		text-decoration: none;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		z-index: 0;
		transition:
			color 0.45s var(--ease-f),
			border-color 0.45s var(--ease-f),
			transform 0.55s var(--ease-f),
			box-shadow 0.55s var(--ease-f);
	}
	.btn::before {
		content: '';
		position: absolute;
		left: -8%;
		right: -8%;
		bottom: 0;
		height: 100%;
		background: linear-gradient(120deg, var(--orange-deep), var(--orange));
		border-radius: 48% 48% 0 0 / 26px 26px 0 0;
		transform: translateY(103%);
		transition:
			transform 0.6s var(--ease-f),
			border-radius 0.6s var(--ease-f);
		z-index: -1;
	}
	.btn::after {
		content: '';
		position: absolute;
		top: -60%;
		bottom: -60%;
		left: 0;
		width: 20%;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
		transform: translateX(-160%) skewX(-18deg);
		opacity: 0;
		z-index: -1;
	}
	.btn:hover,
	.btn:focus-visible {
		color: #fff;
		border-color: var(--orange-bright);
		transform: translateY(-3px);
		box-shadow: 0 18px 38px -14px var(--orange-glow);
	}
	.btn:hover::before,
	.btn:focus-visible::before {
		transform: translateY(0);
		border-radius: 0;
	}
	.btn:hover::after,
	.btn:focus-visible::after {
		animation: btn-sheen 0.9s var(--ease-f) 0.15s;
	}
	.btn:active {
		transform: translateY(-1px) scale(0.985);
		transition-duration: 0.12s;
	}
	@keyframes btn-sheen {
		0% {
			opacity: 0;
			transform: translateX(-160%) skewX(-18deg);
		}
		15% {
			opacity: 1;
		}
		85% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translateX(600%) skewX(-18deg);
		}
	}

	.btn-solid {
		background: linear-gradient(120deg, var(--orange-deep), var(--orange-bright) 52%, var(--orange-deep));
		background-size: 220% 100%;
		background-position: 0% 50%;
		/* Near-black label, not ivory: on a bright ember fill, ivory-on-orange sits
		   around 2.4:1 and fails badly. Dark ink on the same fill clears 7:1. */
		color: #1a0c02;
		border-color: transparent;
		font-weight: 500;
		box-shadow: 0 10px 26px -10px var(--orange-glow);
		transition:
			transform 0.55s var(--ease-f),
			box-shadow 0.55s var(--ease-f),
			background-position 0.75s var(--ease-f);
	}
	.btn-solid::before {
		display: none;
	}
	.btn-solid:hover,
	.btn-solid:focus-visible {
		color: #1a0c02;
		border-color: transparent;
		background-position: 100% 50%;
		box-shadow: 0 20px 44px -14px var(--orange-glow);
	}

	.section-head {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		text-align: center;
		margin-bottom: 3rem;
	}
	.section-head h2,
	.detail h2 {
		font-family: var(--display);
		font-weight: 400;
		font-size: clamp(2rem, 4vw, 3rem);
		line-height: 1.15;
		margin: 0;
	}

	/* ===== OPENING =====
	   box-sizing: border-box on the section — the vertical padding is generous and
	   would otherwise be added on top of any min-height (the trap the hero hit). */
	.opening {
		position: relative;
		box-sizing: border-box;
		overflow: hidden;
		padding: clamp(3.5rem, 8vw, 7rem) 24px clamp(4rem, 9vw, 8rem);
		background: var(--green);
	}
	/* Firelight behind the poster — the warm half of the page's two-tone ground. */
	.ember {
		position: absolute;
		top: 2%;
		right: -14%;
		width: 74vw;
		max-width: 1040px;
		aspect-ratio: 1;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(226, 118, 43, 0.22) 0%,
			rgba(168, 72, 15, 0.1) 40%,
			transparent 68%
		);
		pointer-events: none;
	}
	/* Fusion's motif: concentric rings, struck through the opening. NOT Asia's
	   seigaiha — the wave pattern is the Japanese house's. */
	.rings {
		position: absolute;
		top: 50%;
		right: 4%;
		width: min(60vw, 760px);
		aspect-ratio: 1;
		transform: translateY(-50%);
		pointer-events: none;
		opacity: 0.5;
	}
	.rings span {
		position: absolute;
		inset: 0;
		border: 1px solid rgba(226, 118, 43, 0.16);
		border-radius: 50%;
	}
	.rings span:nth-child(2) {
		inset: 14%;
		border-color: rgba(226, 118, 43, 0.11);
	}
	.rings span:nth-child(3) {
		inset: 28%;
		border-color: rgba(226, 118, 43, 0.07);
	}

	.opening-inner {
		position: relative;
		z-index: 1;
		max-width: 1240px;
		margin: 0 auto;
		display: grid;
		/* The poster is PORTRAIT, so it gets the narrower column — the reverse of
		   Asia's split, where a landscape photo takes the wider one. */
		grid-template-columns: minmax(0, 1.12fr) minmax(0, 0.88fr);
		gap: clamp(2rem, 5vw, 4.5rem);
		align-items: center;
	}

	.opening-copy {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1.5rem;
	}
	.opening h1 {
		margin: 0;
		font-family: var(--display);
		font-weight: 400;
		font-size: clamp(2.8rem, 6.4vw, 5rem);
		line-height: 1.04;
		letter-spacing: -0.01em;
	}
	.opening h1 em {
		font-style: italic;
		background: linear-gradient(96deg, var(--orange-bright), var(--gold-bright));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.ht-line {
		display: block;
		overflow: hidden;
		/* Pad the clip box so descenders aren't sheared by overflow: hidden, then
		   pull it back so layout is unchanged. */
		padding-bottom: 0.12em;
		margin-bottom: -0.12em;
	}
	.ht-in {
		display: block;
		transform: translateY(105%);
		transition: transform 1s cubic-bezier(0.22, 0.9, 0.3, 1);
	}
	.opening.enter .ht-in {
		transform: translateY(0);
	}
	.ht-line:nth-child(2) .ht-in {
		transition-delay: 0.1s;
	}

	.lede {
		max-width: 46ch;
		margin: 0;
		font-size: 1.06rem;
		line-height: 1.75;
		color: var(--muted);
	}

	.denoms {
		display: flex;
		align-items: center;
		gap: 14px;
		font-family: var(--display);
		font-size: 1.1rem;
		color: var(--gold-bright);
		letter-spacing: 0.08em;
	}
	/* Ring pips between the amounts, not Asia's rotated diamonds. */
	.denoms .pip {
		width: 6px;
		height: 6px;
		border: 1px solid var(--orange);
		border-radius: 50%;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
	}

	/* Staged entry for everything but the title lines (which have their own mask). */
	.opening .eyebrow,
	.opening .lede,
	.opening .denoms,
	.opening .actions {
		opacity: 0;
		transform: translateY(18px);
		transition:
			opacity 0.8s var(--ease-f),
			transform 0.8s var(--ease-f);
	}
	.opening.enter .eyebrow {
		opacity: 1;
		transform: none;
	}
	.opening.enter .lede {
		opacity: 1;
		transform: none;
		transition-delay: 0.34s;
	}
	.opening.enter .denoms {
		opacity: 1;
		transform: none;
		transition-delay: 0.42s;
	}
	.opening.enter .actions {
		opacity: 1;
		transform: none;
		transition-delay: 0.5s;
	}

	/* ===== THE POSTER =====
	   Hung as a print: a black mount, a hairline ember frame, and a long shadow. It
	   settles out of a small rise as the page enters. */
	.poster {
		margin: 0;
		position: relative;
		justify-self: center;
		width: 100%;
		max-width: 460px;
		opacity: 0;
		transform: translateY(24px) scale(0.97);
		transition:
			opacity 1.1s var(--ease-f) 0.16s,
			transform 1.4s var(--ease-f) 0.16s;
	}
	.opening.enter .poster {
		opacity: 1;
		transform: none;
	}
	.poster-link {
		display: block;
		position: relative;
		padding: 10px;
		background: linear-gradient(160deg, var(--char-2), var(--green));
		border: 1px solid var(--hair);
		text-decoration: none;
		box-shadow:
			0 40px 90px rgba(0, 0, 0, 0.7),
			0 0 60px -20px var(--orange-glow);
		transition:
			transform 0.6s var(--ease-f),
			box-shadow 0.6s var(--ease-f),
			border-color 0.6s var(--ease-f);
	}
	.poster-link:hover,
	.poster-link:focus-visible {
		transform: translateY(-6px);
		border-color: var(--orange);
		box-shadow:
			0 54px 110px rgba(0, 0, 0, 0.75),
			0 0 90px -20px var(--orange-glow);
	}
	.poster-link img {
		display: block;
		width: 100%;
		height: auto;
	}
	/* The cue sits ON the poster's bottom edge, over a scrim, so it reads as part of
	   the print rather than a caption floating under it. */
	.poster-cue {
		position: absolute;
		left: 10px;
		right: 10px;
		bottom: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 0.9rem 1rem;
		background: linear-gradient(to top, rgba(10, 13, 11, 0.94), rgba(10, 13, 11, 0));
		color: var(--ivory);
		font-family: var(--body-f);
		font-size: 0.7rem;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		transition: color 0.4s var(--ease-f);
	}
	.poster-link:hover .poster-cue,
	.poster-link:focus-visible .poster-cue {
		color: var(--orange-bright);
	}
	/* A small ring holding an arrow — the motif again, at bullet size. */
	.poster-cue-i {
		width: 18px;
		height: 18px;
		border: 1px solid currentColor;
		border-radius: 50%;
		position: relative;
		flex: none;
	}
	.poster-cue-i::after {
		content: '';
		position: absolute;
		inset: 0;
		margin: auto;
		width: 5px;
		height: 5px;
		border-right: 1px solid currentColor;
		border-bottom: 1px solid currentColor;
		transform: translate(-1px, -1px) rotate(-45deg);
	}

	/* ===== CHOOSE ===== */
	.choose {
		max-width: 1240px;
		margin: 0 auto;
		padding: clamp(4rem, 8vw, 7rem) 24px;
	}
	.choose-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 0.82fr);
		gap: clamp(2rem, 5vw, 4rem);
		align-items: center;
	}

	.picker {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
	}
	.amounts {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.amt {
		display: flex;
		align-items: baseline;
		gap: 1.1rem;
		width: 100%;
		box-sizing: border-box;
		min-height: 56px;
		padding: 1rem 1.4rem;
		text-align: left;
		background: var(--char);
		border: 1px solid var(--hair-soft);
		color: var(--ivory);
		font-family: var(--body-f);
		cursor: pointer;
		position: relative;
		overflow: hidden;
		transition:
			border-color 0.3s var(--ease-f),
			background 0.3s var(--ease-f),
			transform 0.3s var(--ease-f);
	}
	/* An ember edge that grows down the leading side as it's chosen. */
	.amt::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 2px;
		background: linear-gradient(to bottom, var(--orange-bright), var(--orange-deep));
		transform: scaleY(0);
		transform-origin: top;
		transition: transform 0.35s var(--ease-f);
	}
	.amt:hover,
	.amt:focus-visible {
		border-color: rgba(226, 118, 43, 0.5);
		transform: translateX(4px);
	}
	.amt.on {
		border-color: var(--orange);
		background: linear-gradient(90deg, rgba(226, 118, 43, 0.16), rgba(226, 118, 43, 0.02));
	}
	.amt.on::before {
		transform: scaleY(1);
	}
	.amt-value {
		font-family: var(--display);
		font-size: 1.7rem;
		line-height: 1;
		min-width: 3.6rem;
	}
	.amt.on .amt-value {
		color: var(--orange-bright);
	}

	/* "For Christmas": a small ruled label, then options that carry a note beside
	   the amount. */
	.xmas-head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 0.7rem;
		font-family: var(--body-f);
		font-size: 0.7rem;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: var(--gold-bright);
	}
	.xmas-head::after {
		content: '';
		flex: 1;
		height: 1px;
		background: linear-gradient(90deg, rgba(212, 175, 55, 0.5), transparent);
	}
	.amt-note {
		font-size: 0.74rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.amt.on .amt-note {
		color: var(--ivory);
	}

	.buy {
		align-self: flex-start;
	}
	.fine {
		margin: 0;
		max-width: 52ch;
		font-size: 0.85rem;
		line-height: 1.7;
		color: var(--faint);
	}
	.fine a {
		color: var(--orange-bright);
		text-decoration: none;
		border-bottom: 1px solid rgba(226, 118, 43, 0.5);
	}

	/* ===== THE VOUCHER ===== */
	.preview-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}
	.voucher {
		position: relative;
		width: 100%;
		max-width: 420px;
		aspect-ratio: 1.586; /* a real card */
		box-sizing: border-box;
		padding: 1.6rem 1.8rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		overflow: hidden;
		background: linear-gradient(145deg, var(--char-2) 0%, var(--green) 58%, #1a0f08 100%);
		box-shadow:
			0 30px 60px rgba(0, 0, 0, 0.6),
			0 0 0 1px rgba(226, 118, 43, 0.24);
		/* Tilted the OTHER way to Asia's card, so the two previews aren't the same
		   prop at the same angle. */
		transform: rotate(2.2deg);
	}
	/* The ring motif, printed on the card. */
	.v-rings {
		position: absolute;
		top: 50%;
		right: -18%;
		width: 78%;
		aspect-ratio: 1;
		transform: translateY(-50%);
		border-radius: 50%;
		/* Hairlines from a repeating gradient, NOT stacked `inset` box-shadows: an
		   inset shadow's spread fills a solid band from the edge inward, so several
		   of them overlap into one tinted disc rather than reading as rings. */
		background: repeating-radial-gradient(
			circle at 50% 50%,
			transparent 0 17px,
			rgba(226, 118, 43, 0.24) 17px 18px
		);
	}
	.v-ember {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 82% 62%, rgba(226, 118, 43, 0.18), transparent 58%);
		pointer-events: none;
	}
	.v-mark {
		position: relative;
		width: 46%;
		height: auto;
		align-self: flex-start;
		opacity: 0.95;
	}
	.v-amount {
		position: relative;
		font-family: var(--display);
		font-size: clamp(2.6rem, 7vw, 3.6rem);
		line-height: 1;
		color: var(--orange-bright);
		animation: v-settle 0.45s var(--ease-f);
	}
	.v-cur {
		font-size: 0.55em;
		vertical-align: 0.35em;
		margin-right: 0.06em;
		opacity: 0.85;
	}
	@keyframes v-settle {
		from {
			opacity: 0.2;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.v-foot {
		position: relative;
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-family: var(--body-f);
		font-size: 0.64rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.v-corner {
		position: absolute;
		width: 26px;
		height: 26px;
		border: 1px solid rgba(226, 118, 43, 0.6);
		pointer-events: none;
	}
	.v-tl {
		top: 12px;
		left: 12px;
		border-right: 0;
		border-bottom: 0;
	}
	.v-tr {
		top: 12px;
		right: 12px;
		border-left: 0;
		border-bottom: 0;
	}
	.v-caption {
		margin: 0;
		font-size: 0.82rem;
		font-style: italic;
		color: var(--faint);
	}

	/* ===== STEPS ===== */
	.steps {
		max-width: 1240px;
		margin: 0 auto;
		padding: clamp(3rem, 7vw, 6rem) 24px;
		border-top: 1px solid var(--hair-soft);
	}
	.step-row {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: clamp(1.2rem, 3vw, 2.4rem);
	}
	.step-row li {
		position: relative;
		padding: 2rem 1.6rem;
		background: linear-gradient(160deg, var(--char), var(--green-2));
		border: 1px solid var(--hair-soft);
		transition:
			border-color 0.4s var(--ease-f),
			transform 0.4s var(--ease-f);
	}
	.step-row li:hover {
		border-color: rgba(226, 118, 43, 0.4);
		transform: translateY(-3px);
	}
	.step-row .n {
		display: block;
		font-family: var(--display);
		font-size: 0.95rem;
		letter-spacing: 0.2em;
		color: var(--orange);
		margin-bottom: 1rem;
	}
	.step-row h3 {
		margin: 0 0 0.6rem;
		font-family: var(--display);
		font-weight: 400;
		font-size: 1.35rem;
	}
	.step-row p {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.7;
		color: var(--muted);
	}

	/* ===== DETAIL ===== */
	.detail {
		max-width: 1240px;
		margin: 0 auto;
		padding: clamp(3rem, 7vw, 6rem) 24px clamp(4rem, 8vw, 7rem);
	}
	.detail-inner {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.75fr);
		gap: clamp(2rem, 5vw, 4rem);
		align-items: start;
	}
	.detail-copy {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: flex-start;
	}
	.facts {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		max-width: 58ch;
	}
	.facts li {
		position: relative;
		padding-left: 1.7rem;
		font-size: 0.98rem;
		line-height: 1.7;
		color: var(--muted);
	}
	/* A small ember ring as the bullet — the page's mark, at bullet size. */
	.facts li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.58em;
		width: 7px;
		height: 7px;
		border: 1px solid var(--orange);
		border-radius: 50%;
	}
	.detail-call {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;
		padding: 2rem 1.8rem;
		background: linear-gradient(160deg, rgba(226, 118, 43, 0.12), rgba(10, 13, 11, 0.4));
		border: 1px solid rgba(226, 118, 43, 0.28);
	}
	.detail-call h3 {
		margin: 0;
		font-family: var(--display);
		font-weight: 400;
		font-size: 1.5rem;
	}
	.detail-call p {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.7;
		color: var(--muted);
	}
	.quiet {
		font-size: 0.85rem;
		color: var(--faint);
		text-decoration: none;
		border-bottom: 1px solid var(--hair-soft);
	}
	.quiet:hover {
		color: var(--orange-bright);
	}

	/* ===== SCROLL REVEALS =====
	   :global(...) is REQUIRED here: Svelte tree-shakes scoped selectors it can't
	   statically match, and [data-in] is set at runtime by the observer — the
	   settled rules would be dropped and everything would stay in its off-state.
	   Pinned under .page so they can't leak to other brands. */
	.page :global([data-reveal='rise']) {
		opacity: 0;
		transform: translateY(26px);
		transition:
			opacity 0.85s var(--ease-f) var(--rd, 0s),
			transform 0.85s var(--ease-f) var(--rd, 0s);
	}
	.page :global([data-reveal='rise'][data-in]) {
		opacity: 1;
		transform: translateY(0);
	}
	.page :global([data-reveal='col-l']) {
		opacity: 0;
		transform: translateX(-30px);
		transition:
			opacity 0.9s var(--ease-f),
			transform 0.9s var(--ease-f);
	}
	.page :global([data-reveal='col-r']) {
		opacity: 0;
		transform: translateX(30px);
		transition:
			opacity 0.9s var(--ease-f) 0.08s,
			transform 0.9s var(--ease-f) 0.08s;
	}
	.page :global([data-reveal='col-l'][data-in]),
	.page :global([data-reveal='col-r'][data-in]) {
		opacity: 1;
		transform: translateX(0);
	}
	.page :global([data-reveal='card']) {
		opacity: 0;
		transform: translateY(34px) scale(0.97);
		transition:
			opacity 0.8s var(--ease-f) var(--rd, 0s),
			transform 0.8s var(--ease-f) var(--rd, 0s);
	}
	.page :global([data-reveal='card'][data-in]) {
		opacity: 1;
		transform: translateY(0) scale(1);
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 1020px) {
		.opening-inner {
			grid-template-columns: 1fr;
			gap: 2.6rem;
		}
		.opening-copy {
			order: 1;
		}
		.poster {
			order: 2;
			max-width: 400px;
		}
		.choose-grid,
		.detail-inner {
			grid-template-columns: 1fr;
		}
		.preview-wrap {
			order: -1;
		}
		.rings {
			opacity: 0.3;
		}
	}
	@media (max-width: 760px) {
		/* ===== PHONE =====
		   Everything below is about getting to the buy button in fewer thumb-scrolls
		   and keeping the headings from wrapping badly. Mirrored in asia/gift-cards —
		   change one, change the other. */

		/* Section heads: sized so "The small print, plainly" holds one line from 360
		   to 430, and balanced so "Three steps, two minutes" breaks at the comma
		   instead of leaving "minutes" alone on the second line. */
		.section-head {
			margin-bottom: 2rem;
		}
		.section-head h2,
		.detail h2 {
			font-size: clamp(1.7rem, 7.6vw, 2rem);
			text-wrap: balance;
		}

		/* Opening → Choose is two stacked paddings on a phone. Trim both, and give the
		   #choose anchor some air: without the scroll margin "Step one" lands hard
		   against the bottom edge of the fixed top bar. */
		.opening {
			padding-bottom: 3.25rem;
		}
		.choose {
			padding-top: 3.5rem;
			padding-bottom: 3.5rem;
			scroll-margin-top: 1.75rem;
		}

		/* The poster cue becomes a caption strip INSIDE the mount, under the print.
		   Laid over the bottom edge it sat on the gift-card artwork — tracked caps
		   across the gold ribbon and the bow — and neither could be read. */
		.poster-link {
			display: flex;
			flex-direction: column;
		}
		.poster-cue {
			position: static;
			padding: 0.95rem 0.5rem 0.4rem;
			background: none;
		}
		.poster-link:hover,
		.poster-link:focus-visible {
			transform: none;
		}

		/* Amounts: three tiles in a row, not three full-width rows holding one short
		   number each — the voucher, the picker and the buy button fit one screen. */
		.amounts {
			flex-direction: row;
			flex-wrap: wrap;
			gap: 0.6rem;
		}
		.amt {
			flex: 1 1 0;
			min-width: 0;
			min-height: 64px;
			padding: 0.9rem 0.4rem;
			align-items: center;
			justify-content: center;
		}
		.amt-value {
			min-width: 0;
			font-size: 1.55rem;
		}
		/* The Christmas vouchers get a row of their own under their label. Left in
		   the single unwrapped row they made it 671px wide in a 342px column, and
		   took the voucher and the buy button off the side of the screen with them. */
		.xmas-head {
			flex: 0 0 100%;
			margin-top: 0.35rem;
		}
		.amt-xmas {
			flex-direction: column;
			gap: 0.35rem;
			min-height: 76px;
		}
		.amt-note {
			font-size: 0.62rem;
			letter-spacing: 0.14em;
			text-align: center;
		}
		/* :hover sticks after a tap on touch, which left the chosen tile nudged 4px
		   out of line with its neighbours (and a tapped step card lifted). */
		.amt:hover,
		.amt:focus-visible,
		.step-row li:hover {
			transform: none;
		}

		/* Steps: the number sits beside the heading rather than on its own line, and
		   the cards lose their desktop padding — all three fit one screen. */
		.step-row {
			grid-template-columns: 1fr;
			gap: 0.75rem;
		}
		.step-row li {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: 1.1rem;
			align-items: baseline;
			padding: 1.35rem 1.25rem 1.4rem;
		}
		.step-row .n {
			margin: 0;
		}
		.step-row h3 {
			margin-bottom: 0.35rem;
			font-size: 1.25rem;
		}
		.step-row p {
			grid-column: 2;
			text-wrap: pretty;
		}

		.voucher {
			transform: none;
		}
		/* The card's foot line runs across the ring motif on a narrow card; lift it to
		   the strength Asia's card prints at so "Geisha Fusion" isn't lost in them. */
		.v-foot {
			color: rgba(242, 236, 224, 0.62);
		}
		.buy,
		.actions .btn,
		.detail-call .btn {
			width: 100%;
		}
		.detail-call {
			padding: 1.6rem 1.4rem;
		}
		/* The email link is one 20px line of text — widen what can be tapped without
		   changing how it looks. */
		.quiet {
			position: relative;
		}
		.quiet::after {
			content: '';
			position: absolute;
			inset: -12px 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ht-in,
		.opening .eyebrow,
		.opening .lede,
		.opening .denoms,
		.opening .actions,
		.poster {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}
		/* Buttons keep the colour change, lose the lift, the rising ink and the glint
		   (the same trade the home page makes). */
		.btn:hover,
		.btn:focus-visible,
		.btn:active,
		.amt:hover,
		.amt:focus-visible,
		.poster-link:hover,
		.poster-link:focus-visible,
		.step-row li:hover {
			transform: none;
		}
		.btn::before {
			transform: none;
			border-radius: 0;
			opacity: 0;
			transition: opacity 0.2s linear;
		}
		.btn:hover::before,
		.btn:focus-visible::before {
			opacity: 1;
		}
		.btn:hover::after,
		.btn:focus-visible::after {
			animation: none;
		}
		.amt::before {
			transition: none;
		}
		.v-amount {
			animation: none;
		}
		.page :global([data-reveal]) {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}
	}
</style>
