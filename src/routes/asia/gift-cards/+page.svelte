<script lang="ts">
	// ===== GIFT VOUCHERS — GEISHA ASIA =====
	//
	// Bespoke page in the redesign language (ink ground, gold, Shippori Mincho /
	// Jost), built around the real photographed card set (static/geisha-asia-gift-cards.webp).
	// It replaced the shared GiftCardPanel here. Fusion has since had a bespoke page
	// too (fusion/gift-cards), so that component is now unreferenced by any route —
	// it's kept only because nothing else depends on removing it.
	//
	// The commerce is unchanged: our own denomination picker hands off to Gift Up's
	// HOSTED checkout with the chosen brand+amount voucher pre-selected, and Gift Up
	// takes the payment, issues, emails and redeems it (see $lib/data/giftup.ts).
	// The CTA is a real <a href> rather than a scripted window.location so it can be
	// opened in a new tab, middle-clicked and read by assistive tech as a link.
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import Seo from '$lib/components/Seo.svelte';
	import { giftUpAmounts, giftUpProductId, giftUpCheckoutUrl } from '$lib/data/giftup';
	import ChristmasVoucher from '$lib/components/ChristmasVoucher.svelte';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const brand = getBrand('asia');

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

	// ===== MOTION =====
	// Same choreography as the Asia home page: a staged entry on mount, then one
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
	title="Gift Vouchers — Geisha Asia"
	description="Geisha Asia gift vouchers from £25. Sent by email in minutes, redeemable against food and drink at Geisha Asia, Benton."
/>

<div class="page" data-brand="asia">
	<!-- ===== OPENING — copy left, the card set floating right over a gold bloom ===== -->
	<section class="opening" class:enter={entered}>
		<div class="glow" aria-hidden="true"></div>
		<div class="seigaiha" aria-hidden="true"></div>

		<div class="opening-inner">
			<div class="opening-copy">
				<span class="eyebrow"><span class="rule"></span>Geisha Asia</span>
				<h1>
					<span class="ht-line"><span class="ht-in">The gift of</span></span>
					<span class="ht-line"><span class="ht-in"><em>Geisha</em></span></span>
				</h1>
				<p class="lede">
					A voucher for the robata grill, the sushi counter and everything that comes with them.
					Choose an amount, add a message, and it lands in their inbox within minutes.
				</p>
				<div class="denoms" aria-hidden="true">
					{#each amounts as a, i}
						{#if i > 0}<span class="dot"></span>{/if}
						<span>£{a}</span>
					{/each}
				</div>
				<div class="actions">
					<a class="btn btn-solid" href="#choose">Choose an amount</a>
					<a class="btn" href="tel:{brand.phone.replace(/\s/g, '')}">Buy in the restaurant</a>
				</div>
			</div>

			<figure class="opening-art">
				<img
					src="/geisha-asia-gift-cards.webp"
					srcset="/geisha-asia-gift-cards-1000.webp 1000w, /geisha-asia-gift-cards.webp 1596w"
					sizes="(max-width: 1020px) 92vw, 46vw"
					width="1596"
					height="986"
					alt="Geisha gift cards — the illustrated card and two black Geisha cards, tied with a gold ribbon"
					fetchpriority="high"
				/>
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
					<a class="btn btn-solid buy" href="tel:{brand.phone.replace(/\s/g, '')}">
						Call {brand.phone} to buy
					</a>
				{/if}

				<p class="fine">
					Payment is handled securely by Gift Up. Vouchers are redeemable against food and drink at {brand.name},
					Benton. Prefer a different amount, or a printed card to hand over? Call us on
					<a href="tel:{brand.phone.replace(/\s/g, '')}">{brand.phone}</a>.
				</p>
			</div>

			<!-- The voucher as it reads — the black card from the photo, in markup, so the
			     chosen amount is shown before they ever reach the checkout. -->
			<div class="preview-wrap" data-reveal="col-r">
				{#if festive}
					<ChristmasVoucher {brand} {amount} />
				{:else}
					<div class="voucher">
						<div class="v-pattern" aria-hidden="true"></div>
						<img class="v-mark" src="/geisha-asia-wordmark.png" alt="" width="1554" height="461" />
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
						<!-- Corner ticks both sit along the TOP: the bottom of the card carries the
						     "Gift Voucher / Geisha Asia" line, and a bottom-right tick lands on it. -->
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
					Corporate gifts, a round of thank-yous for a team, or a voucher for a big table — give us
					a ring and we'll sort it.
				</p>
				<a class="btn" href="tel:{brand.phone.replace(/\s/g, '')}">{brand.phone}</a>
				<a class="quiet" href="mailto:{brand.email}">{brand.email}</a>
			</aside>
		</div>
	</section>

	<SiteFooter {brand} />
</div>

<style>
	/* No `background` — see the note in fusion/+page.svelte. A ground set from a
	   route's `:global(body)` outlives that route and leaks across brands. */
	:global(body) {
		margin: 0;
		color: var(--ink, #f5f1e8);
		font-family: var(--font-body, 'Jost', system-ui, sans-serif);
		font-feature-settings: 'liga', 'dlig';
	}

	.page {
		/* Local design tokens, same set the redesigned home sections declare. */
		--gold: #d4af37;
		--gold-bright: #f4cf6b;
		/* Sakura, the home page's action colour. Gold stays the VOUCHER's colour —
		   frames, the card, the eyebrows — and sakura carries the things you press
		   plus the title accent, exactly as the hero splits them. */
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--sakura-glow: rgba(239, 60, 92, 0.4);
		--hair: rgba(255, 255, 255, 0.12);
		--ivory: #f5f1e8;
		--muted: rgba(245, 241, 232, 0.66);
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease-asia: cubic-bezier(0.2, 0.8, 0.2, 1);

		background: var(--page-bg, #08080b);
		color: var(--ink);
		font-family: var(--font-body);
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
		color: var(--gold);
	}
	.eyebrow .rule {
		display: block;
		width: 34px;
		height: 1px;
		background: var(--gold);
	}

	/* Buttons — the home page's exact pair, ported rather than reinvented so the two
	   pages press the same: sakura ink rising from the bottom edge on the outline
	   button, a drifting gradient on the solid one, one specular sheen across both.
	   ::before is the ink, ::after the sheen, both under the label on z-index -1
	   inside the button's own stacking context. */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-height: 48px;
		padding: 0.85rem 1.9rem;
		border: 1px solid var(--sakura);
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
			color 0.45s var(--ease-asia),
			border-color 0.45s var(--ease-asia),
			transform 0.55s var(--ease-asia),
			box-shadow 0.55s var(--ease-asia);
	}
	/* The rising ink: wider than the button, curved along its leading edge so it
	   reads as liquid, flattening as it lands. */
	.btn::before {
		content: '';
		position: absolute;
		left: -8%;
		right: -8%;
		bottom: 0;
		height: 100%;
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		border-radius: 48% 48% 0 0 / 26px 26px 0 0;
		transform: translateY(103%);
		transition:
			transform 0.6s var(--ease-asia),
			border-radius 0.6s var(--ease-asia);
		z-index: -1;
	}
	.btn::after {
		content: '';
		position: absolute;
		top: -60%;
		bottom: -60%;
		left: 0;
		width: 20%;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
		transform: translateX(-160%) skewX(-18deg);
		opacity: 0;
		z-index: -1;
	}
	.btn:hover,
	.btn:focus-visible {
		color: #fff;
		border-color: var(--sakura-2);
		transform: translateY(-3px);
		box-shadow: 0 18px 38px -14px var(--sakura-glow);
	}
	.btn:hover::before,
	.btn:focus-visible::before {
		transform: translateY(0);
		border-radius: 0;
	}
	.btn:hover::after,
	.btn:focus-visible::after {
		animation: btn-sheen 0.9s var(--ease-asia) 0.15s;
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

	/* Solid: nothing to fill, so the gradient itself drifts across on hover. */
	.btn-solid {
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2) 52%, var(--sakura));
		background-size: 220% 100%;
		background-position: 0% 50%;
		color: #fff;
		border-color: transparent;
		font-weight: 500;
		box-shadow: 0 10px 26px -10px var(--sakura-glow);
		transition:
			transform 0.55s var(--ease-asia),
			box-shadow 0.55s var(--ease-asia),
			background-position 0.75s var(--ease-asia);
	}
	.btn-solid::before {
		display: none;
	}
	.btn-solid:hover,
	.btn-solid:focus-visible {
		border-color: transparent;
		background-position: 100% 50%;
		box-shadow: 0 20px 44px -14px var(--sakura-glow);
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
	   would otherwise be added on top of the min-height (the same trap the hero hit). */
	.opening {
		position: relative;
		box-sizing: border-box;
		overflow: hidden;
		padding: clamp(3.5rem, 8vw, 7rem) 24px clamp(4rem, 9vw, 8rem);
		background: #08080b;
	}
	/* A single warm bloom behind the card set — the gold ribbon in the photo, spread
	   into the room around it. */
	.glow {
		position: absolute;
		top: 6%;
		right: -12%;
		width: 70vw;
		max-width: 1000px;
		aspect-ratio: 1;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(212, 175, 55, 0.2) 0%,
			rgba(212, 175, 55, 0.07) 42%,
			transparent 68%
		);
		pointer-events: none;
	}
	/* Seigaiha — the wave pattern printed on the black cards, echoed faintly across
	   the whole opening so the page and the product share a texture. */
	.seigaiha {
		position: absolute;
		inset: 0;
		pointer-events: none;
		opacity: 0.06;
		background-image: repeating-radial-gradient(
			circle at 50% 100%,
			transparent 0 12px,
			rgba(245, 241, 232, 0.9) 12px 13px,
			transparent 13px 26px
		);
		background-size: 56px 28px;
		mask-image: linear-gradient(to bottom, #000 0%, transparent 72%);
	}

	.opening-inner {
		position: relative;
		z-index: 1;
		max-width: 1240px;
		margin: 0 auto;
		display: grid;
		/* The copy column has to hold the two actions side by side — much under
		   0.95fr here and "Buy in the restaurant" wraps onto its own row. */
		grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
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
	/* The accent line, in the hero's sakura — "Geisha" here is the same beat as
	   "Asia" on the home page. */
	.opening h1 em {
		font-style: italic;
		color: var(--sakura-2);
	}
	/* Each line is clipped and its inner span rises out of the mask on entry. */
	.ht-line {
		display: block;
		overflow: hidden;
		/* The mask is one line-height tall (1.04), which sheared the "g" of "gift"
		   off at the baseline and nipped the top of the italic capital. Pad the clip
		   box and pull it back by the same amount, so the layout is unchanged. */
		padding: 0.06em 0.08em 0.2em 0;
		margin: -0.06em -0.08em -0.2em 0;
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
		color: var(--gold);
		letter-spacing: 0.08em;
	}
	/* Sakura pips between the amounts — the same diamond the hero drops down its
	   scroll cue. */
	.denoms .dot {
		width: 5px;
		height: 5px;
		background: var(--sakura-2);
		transform: rotate(45deg);
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
			opacity 0.8s var(--ease-asia),
			transform 0.8s var(--ease-asia);
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

	/* The photograph: held slightly off-square, lifted off the ground with a long
	   shadow, and settling out of a small push-in as the page enters. */
	.opening-art {
		margin: 0;
		position: relative;
		opacity: 0;
		transform: perspective(1400px) rotateY(-9deg) rotateX(2deg) scale(0.94);
		transition:
			opacity 1.1s var(--ease-asia) 0.16s,
			transform 1.4s var(--ease-asia) 0.16s;
	}
	.opening.enter .opening-art {
		opacity: 1;
		transform: perspective(1400px) rotateY(-6deg) rotateX(1.5deg) scale(1);
	}
	.opening-art img {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 14px;
		box-shadow:
			0 40px 90px rgba(0, 0, 0, 0.6),
			0 0 0 1px rgba(212, 175, 55, 0.18);
	}
	/* Gold hairline frame, offset — the "mounted" look the redesign uses for stills. */
	.opening-art::after {
		content: '';
		position: absolute;
		inset: 18px -18px -18px 18px;
		border: 1px solid rgba(212, 175, 55, 0.32);
		border-radius: 14px;
		z-index: -1;
		pointer-events: none;
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
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--hair);
		color: var(--ivory);
		font-family: var(--body-f);
		cursor: pointer;
		transition:
			border-color 0.3s var(--ease-asia),
			background 0.3s var(--ease-asia),
			transform 0.3s var(--ease-asia);
	}
	.amt:hover,
	.amt:focus-visible {
		border-color: rgba(212, 175, 55, 0.55);
		transform: translateX(4px);
	}
	.amt.on {
		border-color: var(--gold);
		background: linear-gradient(90deg, rgba(212, 175, 55, 0.16), rgba(212, 175, 55, 0.02));
	}
	.amt-value {
		font-family: var(--display);
		font-size: 1.7rem;
		line-height: 1;
		min-width: 3.6rem;
	}
	.amt.on .amt-value {
		color: var(--gold-bright);
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
		color: rgba(245, 241, 232, 0.55);
	}
	.fine a {
		color: var(--gold-bright);
		text-decoration: none;
		border-bottom: 1px solid rgba(212, 175, 55, 0.5);
	}

	/* The voucher itself — the black Geisha card, rebuilt in markup. */
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
		border-radius: 14px;
		overflow: hidden;
		background: linear-gradient(145deg, #17171b 0%, #0b0b0e 55%, #131317 100%);
		box-shadow:
			0 30px 60px rgba(0, 0, 0, 0.55),
			0 0 0 1px rgba(212, 175, 55, 0.22);
		transform: rotate(-2.5deg);
	}
	.v-pattern {
		position: absolute;
		inset: 0;
		opacity: 0.11;
		background-image: repeating-radial-gradient(
			circle at 50% 100%,
			transparent 0 9px,
			rgba(245, 241, 232, 0.55) 9px 10px,
			transparent 10px 20px
		);
		background-size: 42px 21px;
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
		color: var(--gold-bright);
		/* The number swaps as they pick — a small settle so it doesn't just blink. */
		animation: v-settle 0.45s var(--ease-asia);
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
		color: rgba(245, 241, 232, 0.62);
	}
	/* Two gold corner ticks, as on the printed card. */
	.v-corner {
		position: absolute;
		width: 26px;
		height: 26px;
		border: 1px solid rgba(212, 175, 55, 0.6);
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
		color: rgba(245, 241, 232, 0.5);
	}

	/* ===== STEPS ===== */
	.steps {
		max-width: 1240px;
		margin: 0 auto;
		padding: clamp(3rem, 7vw, 6rem) 24px;
		border-top: 1px solid var(--hair);
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
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--hair);
	}
	.step-row .n {
		display: block;
		font-family: var(--display);
		font-size: 0.95rem;
		letter-spacing: 0.2em;
		color: var(--gold);
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
	/* A gold diamond bullet — the mark used through the redesign. */
	.facts li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.62em;
		width: 6px;
		height: 6px;
		background: var(--gold);
		transform: rotate(45deg);
	}
	.detail-call {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;
		padding: 2rem 1.8rem;
		/* Sakura-tinted, not gold: it's the page's other call to action, and it holds
		   an outline button that is now sakura-edged. */
		background: linear-gradient(160deg, rgba(239, 60, 92, 0.11), rgba(255, 255, 255, 0.015));
		border: 1px solid rgba(239, 60, 92, 0.28);
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
		color: rgba(245, 241, 232, 0.55);
		text-decoration: none;
		border-bottom: 1px solid var(--hair);
	}
	.quiet:hover {
		color: var(--gold-bright);
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
			opacity 0.85s var(--ease-asia) var(--rd, 0s),
			transform 0.85s var(--ease-asia) var(--rd, 0s);
	}
	.page :global([data-reveal='rise'][data-in]) {
		opacity: 1;
		transform: translateY(0);
	}
	.page :global([data-reveal='col-l']) {
		opacity: 0;
		transform: translateX(-30px);
		transition:
			opacity 0.9s var(--ease-asia),
			transform 0.9s var(--ease-asia);
	}
	.page :global([data-reveal='col-r']) {
		opacity: 0;
		transform: translateX(30px);
		transition:
			opacity 0.9s var(--ease-asia) 0.08s,
			transform 0.9s var(--ease-asia) 0.08s;
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
			opacity 0.8s var(--ease-asia) var(--rd, 0s),
			transform 0.8s var(--ease-asia) var(--rd, 0s);
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
		.opening-art {
			order: 2;
			transform: none;
		}
		.opening.enter .opening-art {
			transform: none;
		}
		.opening-art::after {
			inset: 12px -12px -12px 12px;
		}
		.choose-grid,
		.detail-inner {
			grid-template-columns: 1fr;
		}
		.preview-wrap {
			order: -1;
		}
	}
	@media (max-width: 760px) {
		/* ===== PHONE =====
		   Everything below is about getting to the buy button in fewer thumb-scrolls
		   and keeping the headings from wrapping badly. Mirrored in fusion/gift-cards —
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
		/* The offset frame hangs 12px to the right of the photo, i.e. half into the
		   gutter. Pull the photo in so the FRAME lands on the gutter and shares its
		   right edge with the buttons above. */
		.opening-art {
			margin-right: 12px;
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
		   the single unwrapped row they made it far wider than the column, and took
		   the voucher and the buy button off the side of the screen with them. */
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
		   out of line with its neighbours. */
		.amt:hover,
		.amt:focus-visible {
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
		.opening-art {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}
		/* Buttons keep the colour change, lose the lift, the rising ink and the
		   glint (same trade the home page makes). */
		.btn:hover,
		.btn:focus-visible,
		.btn:active,
		.amt:hover,
		.amt:focus-visible {
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
