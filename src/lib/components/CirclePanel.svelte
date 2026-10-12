<script lang="ts">
	// The Geisha Circle — shared, theme-token-driven members/loyalty page used by
	// both brands. Renders dark-gold on Asia and editorial-cream on Fusion purely
	// via the brand's CSS custom properties (see theme/tokens.css), exactly like
	// every other shared *Panel. Brand-specific polish stays under
	// [data-brand='…'] so neither brand can break the other.
	//
	// Content comes from a LoyaltyProgram (admin-editable via /admin/circle, with
	// baked-in defaults). Nothing here is hardcoded copy — it all flows from props.
	//
	// Motion: a self-contained IntersectionObserver sets data-in on [data-reveal]
	// nodes. The "settled" rules are RUNTIME-applied, so per asia-home-motion's
	// tree-shaking trap they MUST be :global() and pinned under .circle so Svelte
	// doesn't drop them. All motion is gated on prefers-reduced-motion.

	import { onMount } from 'svelte';
	import type { Brand } from '$lib/data/brand';
	import type { LoyaltyProgram } from '$lib/data/loyalty';

	let { brand, program }: { brand: Brand; program: LoyaltyProgram } = $props();

	const base = $derived(`/${brand.id}`);

	// ── Interactive "what can I get?" points dial ──────────────────────────────
	// A slider the guest drags to feel out the scheme: it lights up the tier
	// they'd be at and the rewards now within reach. Pure front-end delight; the
	// real balance comes later once the scheme is wired to accounts.
	const maxPoints = $derived(
		Math.max(
			program.tiers[program.tiers.length - 1]?.threshold ?? 6000,
			...program.rewards.map((r) => r.cost),
			1000
		) + 2000
	);
	let points = $state(0);
	// Seed the dial at a pleasing mid-point once we know the range.
	onMount(() => {
		points = Math.round(maxPoints * 0.42);
	});

	const currentTier = $derived(
		[...program.tiers].reverse().find((t) => points >= t.threshold) ?? program.tiers[0]
	);
	const nextTier = $derived(program.tiers.find((t) => t.threshold > points));
	const toNext = $derived(nextTier ? nextTier.threshold - points : 0);
	const affordable = $derived(program.rewards.filter((r) => r.cost <= points).length);

	function fmt(n: number) {
		return n.toLocaleString('en-GB');
	}

	// ── Reveal-on-scroll (see header note re: the :global tree-shaking trap) ────
	let root: HTMLElement;
	onMount(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
		if (reduce) {
			nodes.forEach((n) => n.setAttribute('data-in', ''));
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						e.target.setAttribute('data-in', '');
						io.unobserve(e.target);
					}
				}
			},
			{ threshold: 0.16, rootMargin: '0px 0px -8% 0px' }
		);
		nodes.forEach((n) => io.observe(n));
		return () => io.disconnect();
	});

	// Hero entry: flip `entered` on the second frame so the CSS transition runs
	// (single rAF coalesces with first paint — see fusion-editorial-redesign).
	let entered = $state(false);
	onMount(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) {
			entered = true;
			return;
		}
		requestAnimationFrame(() => requestAnimationFrame(() => (entered = true)));
	});

	// Membership card pointer-tilt (desktop, fine pointers only). Tilts toward the
	// cursor for a tactile, "this is a real object" feel.
	let tiltX = $state(0);
	let tiltY = $state(0);
	function onCardMove(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		const el = e.currentTarget as HTMLElement;
		const r = el.getBoundingClientRect();
		const px = (e.clientX - r.left) / r.width - 0.5;
		const py = (e.clientY - r.top) / r.height - 0.5;
		tiltY = px * 14;
		tiltX = -py * 12;
	}
	function onCardLeave() {
		tiltX = 0;
		tiltY = 0;
	}
</script>

<section class="circle" data-brand={brand.id} class:entered bind:this={root}>
	<!-- ── HERO ───────────────────────────────────────────────────────────── -->
	<header class="hero">
		<div class="hero-copy">
			<p class="eyebrow ht-rise" style="--d:0s">{program.eyebrow}</p>
			<h1 class="hero-title">
				<span class="ht-line"><span class="ht-in" style="--d:.08s">{program.name}</span></span>
			</h1>
			<p class="hero-headline ht-rise" style="--d:.32s">{@html program.headline}</p>
			<p class="hero-intro ht-rise" style="--d:.42s">{program.intro}</p>
			<div class="hero-actions ht-rise" style="--d:.52s">
				<a class="btn-primary" href="{base}/bookings">{program.ctaLabel}</a>
				<a class="btn-ghost" href="#how">See how it works ›</a>
			</div>
		</div>

		<!-- Membership card mock — the centrepiece. Tilts to the cursor, with a
		     slow shimmer sweep across the foil. -->
		<div
			class="card-stage ht-card"
			role="img"
			aria-label="{program.name} membership card"
			onpointermove={onCardMove}
			onpointerleave={onCardLeave}
			style="--tx:{tiltX}deg; --ty:{tiltY}deg"
		>
			<div class="card">
				<div class="card-sheen"></div>
				<div class="card-top">
					<span class="card-brand">Geisha</span>
					<span class="card-chip" aria-hidden="true"></span>
				</div>
				<div class="card-mid">
					<span class="card-program">{program.name}</span>
					<span class="card-tier">{currentTier?.name ?? 'Member'} member</span>
				</div>
				<div class="card-bottom">
					<span class="card-name">Your name here</span>
					<span class="card-tag">{program.cardTagline}</span>
				</div>
			</div>
		</div>
	</header>

	<!-- ── HOW IT WORKS (earn) ────────────────────────────────────────────── -->
	<div class="band" id="how">
		<div class="band-head" data-reveal="rise">
			<span class="kicker">How it works</span>
			<h2>Earn as you go.</h2>
			<p class="sub">
				{program.pointsPerPound} points for every £1, across both Geisha restaurants — dine in, collect,
				or order in.
			</p>
		</div>
		<div class="earn-grid">
			{#each program.earn as step, i}
				<div class="earn-step" data-reveal="card" style="--rd:{i * 0.07}s">
					<span class="earn-figure">{step.figure}</span>
					<h3>{step.title}</h3>
					<p>{step.blurb}</p>
				</div>
			{/each}
		</div>
	</div>

	<!-- ── INTERACTIVE POINTS DIAL ────────────────────────────────────────── -->
	<div class="band dial-band">
		<div class="band-head" data-reveal="rise">
			<span class="kicker">Try it</span>
			<h2>What could you unwind?</h2>
			<p class="sub">Drag the dial to see your tier and the rewards within reach.</p>
		</div>

		<div class="dial" data-reveal="rise" style="--rd:.08s">
			<div class="dial-readout">
				<span class="dial-points">{fmt(points)}</span>
				<span class="dial-unit">points</span>
			</div>

			<label class="dial-slider">
				<span class="sr-only">Points</span>
				<input
					type="range"
					min="0"
					max={maxPoints}
					step="100"
					bind:value={points}
					style="--pct:{(points / maxPoints) * 100}%"
					aria-label="Choose a points balance to preview"
				/>
			</label>

			<div class="dial-stats">
				<div class="dial-stat">
					<span class="ds-label">You’d be</span>
					<span class="ds-value">{currentTier?.name ?? '—'}</span>
				</div>
				<div class="dial-stat">
					<span class="ds-label">Rewards in reach</span>
					<span class="ds-value">{affordable}</span>
				</div>
				<div class="dial-stat">
					<span class="ds-label">{nextTier ? `To ${nextTier.name}` : 'Top tier'}</span>
					<span class="ds-value">{nextTier ? fmt(toNext) : '★'}</span>
				</div>
			</div>
		</div>
	</div>

	<!-- ── TIER LADDER ────────────────────────────────────────────────────── -->
	<div class="band">
		<div class="band-head" data-reveal="rise">
			<span class="kicker">The ladder</span>
			<h2>Three tiers, quietly better.</h2>
			<p class="sub">The more you visit, the more the room opens up.</p>
		</div>
		<div class="tiers">
			{#each program.tiers as tier, i}
				<article
					class="tier"
					class:active={currentTier?.id === tier.id}
					data-reveal="card"
					style="--rd:{i * 0.1}s"
				>
					<div class="tier-head">
						{#if tier.mark}<span class="tier-mark" aria-hidden="true">{tier.mark}</span>{/if}
						<div class="tier-id">
							<h3>{tier.name}</h3>
							<span class="tier-sub">{tier.subtitle}</span>
						</div>
					</div>
					<p class="tier-thresh">
						{tier.threshold === 0 ? 'From day one' : `${fmt(tier.threshold)} points`}
					</p>
					<ul class="tier-perks">
						{#each tier.perks as perk}
							<li>{perk}</li>
						{/each}
					</ul>
					{#if currentTier?.id === tier.id}<span class="tier-flag">You’re here</span>{/if}
				</article>
			{/each}
		</div>
	</div>

	<!-- ── REWARDS GRID ───────────────────────────────────────────────────── -->
	<div class="band">
		<div class="band-head" data-reveal="rise">
			<span class="kicker">Spend them</span>
			<h2>Rewards worth saving for.</h2>
			<p class="sub">Redeem in a tap when you book or at the table.</p>
		</div>
		<div class="rewards">
			{#each program.rewards as reward, i}
				<article
					class="reward"
					class:featured={reward.featured}
					class:reached={points >= reward.cost}
					data-reveal="card"
					style="--rd:{i * 0.06}s"
				>
					{#if reward.featured}<span class="reward-tag">Members’ favourite</span>{/if}
					<span class="reward-cost">{fmt(reward.cost)}<small>pts</small></span>
					<h3>{reward.title}</h3>
					<p>{reward.blurb}</p>
					<span class="reward-state" aria-hidden="true">
						{points >= reward.cost ? 'Within reach' : `${fmt(reward.cost - points)} to go`}
					</span>
				</article>
			{/each}
		</div>
	</div>

	<!-- ── PERKS STRIP ────────────────────────────────────────────────────── -->
	<div class="band perks-band" data-reveal="rise">
		<ul class="perks">
			{#each program.perks as perk}
				<li>{perk}</li>
			{/each}
		</ul>
	</div>

	<!-- ── FAQ ────────────────────────────────────────────────────────────── -->
	<div class="band">
		<div class="band-head" data-reveal="rise">
			<span class="kicker">Good to know</span>
			<h2>The fine details.</h2>
		</div>
		<div class="faq">
			{#each program.faq as item, i}
				<details class="faq-item" data-reveal="card" style="--rd:{i * 0.05}s">
					<summary>
						<span>{item.q}</span>
						<span class="faq-plus" aria-hidden="true"></span>
					</summary>
					<p>{item.a}</p>
				</details>
			{/each}
		</div>
	</div>

	<!-- ── CLOSING CTA ────────────────────────────────────────────────────── -->
	<div class="closer" data-reveal="rise">
		<h2>{program.joinBonus} points are waiting.</h2>
		<p>Join free today and your welcome gift lands straight away.</p>
		<a class="btn-primary big" href="{base}/bookings">{program.ctaLabel}</a>
		<p class="fine">{program.finePrint}</p>
	</div>
</section>

<style>
	/* ===== Layout shell ===================================================== */
	.circle {
		--ease-circle: cubic-bezier(0.22, 1, 0.36, 1);
		color: var(--ink);
		font-family: var(--font-body);
		overflow: clip;
	}
	.band {
		max-width: 1120px;
		margin: 0 auto;
		padding: clamp(3.4rem, 8vh, 6rem) 1.6rem;
	}
	.band-head {
		text-align: center;
		max-width: 44ch;
		margin: 0 auto clamp(2rem, 5vh, 3.4rem);
	}
	.kicker {
		display: inline-block;
		font-family: var(--font-sans);
		font-size: 0.66rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 0.9rem;
	}
	.band-head h2 {
		font-family: var(--font-display);
		font-size: clamp(1.9rem, 4.4vw, 3rem);
		font-weight: 500;
		margin: 0 0 0.6rem;
		line-height: 1.08;
	}
	.band-head .sub {
		color: var(--ink-soft);
		font-size: 1.08rem;
		line-height: 1.5;
		margin: 0;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* ===== Hero ============================================================= */
	.hero {
		max-width: 1180px;
		margin: 0 auto;
		padding: clamp(2.4rem, 7vh, 5rem) 1.6rem clamp(2rem, 5vh, 4rem);
		display: grid;
		grid-template-columns: 1.05fr 0.95fr;
		gap: clamp(2rem, 5vw, 4.5rem);
		align-items: center;
	}
	.eyebrow {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0 0 1rem;
	}
	.hero-title {
		margin: 0 0 1.2rem;
		font-family: var(--font-display);
		font-weight: 500;
		font-size: clamp(2.8rem, 7vw, 5.2rem);
		line-height: 1;
	}
	.ht-line {
		display: block;
		overflow: hidden;
	}
	.ht-in {
		display: block;
	}
	.hero-headline {
		font-family: var(--font-display);
		font-style: italic;
		font-size: clamp(1.5rem, 3.2vw, 2.2rem);
		line-height: 1.18;
		margin: 0 0 1.1rem;
		color: var(--ink);
	}
	.hero-headline :global(em) {
		font-style: normal;
		color: var(--accent);
	}
	.hero-intro {
		color: var(--ink-soft);
		font-size: 1.12rem;
		line-height: 1.62;
		max-width: 46ch;
		margin: 0 0 1.8rem;
	}
	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
	}

	/* ----- Buttons ----- */
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-sans);
		font-size: 0.74rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--bg);
		background: var(--accent);
		padding: 0.95rem 2rem;
		border-radius: 2px;
		border: 1px solid var(--accent);
		transition:
			background 0.3s ease,
			transform 0.3s var(--ease-circle),
			box-shadow 0.3s ease;
	}
	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 12px 30px -12px color-mix(in srgb, var(--accent) 70%, transparent);
		background: color-mix(in srgb, var(--accent) 88%, var(--ink));
	}
	.btn-primary.big {
		padding: 1.1rem 2.6rem;
		font-size: 0.8rem;
	}
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--ink-soft);
		transition: color 0.25s ease;
	}
	.btn-ghost:hover {
		color: var(--accent);
	}

	/* ----- Membership card ----- */
	.card-stage {
		perspective: 1100px;
		display: flex;
		justify-content: center;
	}
	.card {
		position: relative;
		width: min(420px, 100%);
		aspect-ratio: 1.586; /* ISO card ratio */
		border-radius: 16px;
		padding: clamp(1.3rem, 3vw, 1.8rem);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		color: var(--ink);
		background:
			radial-gradient(
				120% 140% at 0% 0%,
				color-mix(in srgb, var(--accent) 26%, var(--card)) 0%,
				transparent 55%
			),
			linear-gradient(150deg, var(--bg-2) 0%, var(--card) 100%);
		border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
		box-shadow:
			0 30px 60px -22px rgba(0, 0, 0, 0.55),
			inset 0 1px 0 color-mix(in srgb, var(--accent) 30%, transparent);
		transform: rotateX(var(--tx, 0deg)) rotateY(var(--ty, 0deg));
		transition: transform 0.18s ease-out;
		transform-style: preserve-3d;
		overflow: hidden;
	}
	/* Slow shimmer sweep across the card foil. */
	.card-sheen {
		position: absolute;
		inset: -40% -10%;
		background: linear-gradient(
			115deg,
			transparent 38%,
			color-mix(in srgb, var(--accent) 30%, transparent) 50%,
			transparent 62%
		);
		transform: translateX(-30%);
		animation: sheen 6.5s ease-in-out infinite;
		pointer-events: none;
	}
	@keyframes sheen {
		0%,
		18% {
			transform: translateX(-60%);
			opacity: 0;
		}
		32% {
			opacity: 1;
		}
		60%,
		100% {
			transform: translateX(60%);
			opacity: 0;
		}
	}
	.card-top,
	.card-mid,
	.card-bottom {
		position: relative;
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 1rem;
	}
	.card-brand {
		font-family: var(--font-display);
		font-size: 1.5rem;
		letter-spacing: 0.04em;
	}
	.card-chip {
		width: 42px;
		height: 30px;
		border-radius: 6px;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent) 80%, #fff) 0%,
			var(--accent) 100%
		);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
		align-self: flex-start;
	}
	.card-mid {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
	}
	.card-program {
		font-family: var(--font-display);
		font-size: clamp(1.3rem, 3.4vw, 1.7rem);
	}
	.card-tier {
		font-family: var(--font-sans);
		font-size: 0.64rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.card-name {
		font-family: var(--font-sans);
		font-size: 0.78rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.card-tag {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 0.82rem;
		color: var(--ink-faint);
		text-align: right;
		max-width: 55%;
	}

	/* ===== Earn grid ======================================================= */
	.earn-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1.2rem;
	}
	.earn-step {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 2rem 1.6rem;
		text-align: center;
		transition:
			transform 0.3s var(--ease-circle),
			border-color 0.3s ease;
	}
	.earn-step:hover {
		transform: translateY(-4px);
		border-color: var(--accent);
	}
	.earn-figure {
		display: block;
		font-family: var(--font-display);
		font-size: 2.6rem;
		line-height: 1;
		color: var(--accent);
		margin-bottom: 0.7rem;
	}
	.earn-step h3 {
		font-family: var(--font-display);
		font-size: 1.25rem;
		font-weight: 500;
		margin: 0 0 0.4rem;
	}
	.earn-step p {
		color: var(--ink-soft);
		font-size: 0.98rem;
		line-height: 1.5;
		margin: 0;
	}

	/* ===== Points dial ===================================================== */
	.dial-band .band-head {
		margin-bottom: clamp(1.4rem, 3vh, 2.2rem);
	}
	.dial {
		max-width: 760px;
		margin: 0 auto;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 18px;
		padding: clamp(1.8rem, 4vw, 2.8rem);
		text-align: center;
	}
	.dial-readout {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 1.4rem;
	}
	.dial-points {
		font-family: var(--font-display);
		font-size: clamp(3rem, 9vw, 4.6rem);
		line-height: 1;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.dial-unit {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.dial-slider {
		display: block;
		margin: 0 auto 1.8rem;
	}
	/* Custom range track + thumb, fed a --pct so the filled portion is accent. */
	.dial-slider input {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 6px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--accent) 0%,
			var(--accent) var(--pct, 40%),
			color-mix(in srgb, var(--ink) 16%, transparent) var(--pct, 40%),
			color-mix(in srgb, var(--ink) 16%, transparent) 100%
		);
		cursor: pointer;
		outline: none;
	}
	.dial-slider input::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--accent);
		border: 3px solid var(--bg);
		box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--accent) 80%, transparent);
		cursor: grab;
		transition: transform 0.15s ease;
	}
	.dial-slider input::-webkit-slider-thumb:active {
		cursor: grabbing;
		transform: scale(1.12);
	}
	.dial-slider input::-moz-range-thumb {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--accent);
		border: 3px solid var(--bg);
		cursor: grab;
	}
	.dial-slider input:focus-visible {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.dial-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		border-top: 1px solid var(--line);
		padding-top: 1.5rem;
	}
	.ds-label {
		display: block;
		font-family: var(--font-sans);
		font-size: 0.62rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin-bottom: 0.35rem;
	}
	.ds-value {
		font-family: var(--font-display);
		font-size: clamp(1.3rem, 4vw, 1.8rem);
		color: var(--ink);
	}

	/* ===== Tiers =========================================================== */
	.tiers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1.2rem;
		align-items: stretch;
	}
	.tier {
		position: relative;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 2rem 1.8rem 2.2rem;
		display: flex;
		flex-direction: column;
		transition:
			transform 0.35s var(--ease-circle),
			border-color 0.35s ease,
			box-shadow 0.35s ease;
	}
	.tier.active {
		border-color: var(--accent);
		box-shadow: 0 24px 48px -28px color-mix(in srgb, var(--accent) 70%, transparent);
		transform: translateY(-4px);
	}
	.tier-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.tier-mark {
		font-family: var(--font-display);
		font-size: 2.4rem;
		line-height: 1;
		color: var(--accent);
		width: 1.6em;
		text-align: center;
		flex: none;
	}
	.tier-id h3 {
		font-family: var(--font-display);
		font-size: 1.6rem;
		font-weight: 500;
		margin: 0;
	}
	.tier-sub {
		font-style: italic;
		color: var(--ink-soft);
		font-size: 0.95rem;
	}
	.tier-thresh {
		font-family: var(--font-sans);
		font-size: 0.68rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0 0 1.1rem;
		padding-bottom: 1.1rem;
		border-bottom: 1px solid var(--line);
	}
	.tier-perks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		flex: 1;
	}
	.tier-perks li {
		position: relative;
		padding-left: 1.4rem;
		color: var(--ink-soft);
		font-size: 1rem;
		line-height: 1.45;
	}
	.tier-perks li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.55em;
		width: 7px;
		height: 7px;
		transform: rotate(45deg);
		background: var(--accent);
	}
	.tier-flag {
		position: absolute;
		top: 1.2rem;
		right: 1.2rem;
		font-family: var(--font-sans);
		font-size: 0.58rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--bg);
		background: var(--accent);
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
	}

	/* ===== Rewards ========================================================= */
	.rewards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1.2rem;
	}
	.reward {
		position: relative;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 1.8rem 1.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		transition:
			transform 0.3s var(--ease-circle),
			border-color 0.3s ease,
			opacity 0.4s ease;
	}
	.reward:hover {
		transform: translateY(-4px);
		border-color: var(--accent);
	}
	.reward.featured {
		border-color: color-mix(in srgb, var(--accent) 55%, transparent);
		background:
			radial-gradient(
				140% 120% at 100% 0%,
				color-mix(in srgb, var(--accent) 12%, transparent) 0%,
				transparent 60%
			),
			var(--card);
	}
	.reward-tag {
		position: absolute;
		top: -0.7rem;
		left: 1.4rem;
		font-family: var(--font-sans);
		font-size: 0.56rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--bg);
		background: var(--accent);
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
	}
	.reward-cost {
		font-family: var(--font-display);
		font-size: 2rem;
		line-height: 1;
		color: var(--accent);
	}
	.reward-cost small {
		font-size: 0.9rem;
		margin-left: 0.2rem;
		color: var(--ink-soft);
	}
	.reward h3 {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 500;
		margin: 0.2rem 0 0;
	}
	.reward p {
		color: var(--ink-soft);
		font-size: 0.98rem;
		line-height: 1.5;
		margin: 0;
		flex: 1;
	}
	.reward-state {
		font-family: var(--font-sans);
		font-size: 0.64rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin-top: 0.6rem;
		transition: color 0.3s ease;
	}
	.reward.reached {
		border-color: color-mix(in srgb, var(--accent) 60%, transparent);
	}
	.reward.reached .reward-state {
		color: var(--accent);
	}

	/* ===== Perks strip ===================================================== */
	.perks-band {
		max-width: 1000px;
	}
	.perks {
		list-style: none;
		margin: 0;
		padding: clamp(1.6rem, 4vw, 2.4rem);
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem 2rem;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 16px;
	}
	.perks li {
		position: relative;
		padding-left: 1.6rem;
		font-size: 1.02rem;
		line-height: 1.45;
		color: var(--ink-soft);
	}
	.perks li::before {
		content: '✦';
		position: absolute;
		left: 0;
		top: 0;
		color: var(--accent);
		font-size: 0.9rem;
	}

	/* ===== FAQ ============================================================= */
	.faq {
		max-width: 760px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
	}
	.faq-item {
		border-bottom: 1px solid var(--line);
	}
	.faq-item summary {
		list-style: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.3rem 0.2rem;
		font-family: var(--font-display);
		font-size: 1.3rem;
		color: var(--ink);
	}
	.faq-item summary::-webkit-details-marker {
		display: none;
	}
	.faq-plus {
		position: relative;
		width: 16px;
		height: 16px;
		flex: none;
	}
	.faq-plus::before,
	.faq-plus::after {
		content: '';
		position: absolute;
		background: var(--accent);
		transition:
			transform 0.3s var(--ease-circle),
			opacity 0.3s ease;
	}
	.faq-plus::before {
		top: 7px;
		left: 0;
		width: 16px;
		height: 2px;
	}
	.faq-plus::after {
		top: 0;
		left: 7px;
		width: 2px;
		height: 16px;
	}
	.faq-item[open] .faq-plus::after {
		transform: rotate(90deg);
		opacity: 0;
	}
	.faq-item p {
		margin: 0;
		padding: 0 0.2rem 1.4rem;
		color: var(--ink-soft);
		font-size: 1.05rem;
		line-height: 1.6;
		max-width: 60ch;
	}

	/* ===== Closer ========================================================== */
	.closer {
		max-width: 760px;
		margin: 0 auto;
		padding: clamp(3.4rem, 9vh, 6.5rem) 1.6rem clamp(4rem, 10vh, 7rem);
		text-align: center;
	}
	.closer h2 {
		font-family: var(--font-display);
		font-size: clamp(2rem, 5.4vw, 3.4rem);
		font-weight: 500;
		margin: 0 0 0.7rem;
		line-height: 1.05;
	}
	.closer > p {
		color: var(--ink-soft);
		font-size: 1.12rem;
		margin: 0 0 1.8rem;
	}
	.closer .fine {
		margin: 1.8rem auto 0;
		max-width: 52ch;
		font-family: var(--font-sans);
		font-size: 0.7rem;
		line-height: 1.6;
		letter-spacing: 0.02em;
		color: var(--ink-faint);
	}

	/* ===== Responsive ====================================================== */
	@media (max-width: 880px) {
		.hero {
			grid-template-columns: 1fr;
			text-align: center;
			gap: 2.6rem;
		}
		.hero-intro {
			margin-left: auto;
			margin-right: auto;
		}
		.hero-actions {
			justify-content: center;
		}
		.card-tag {
			max-width: none;
		}
	}

	/* ===== Motion (entry + reveals) =======================================
	   RUNTIME-applied data-in (and the entry `.entered` flip) means the SETTLED
	   states must survive Svelte's scoped-CSS tree-shaking. Hero entry classes
	   are matched statically so they're safe un-globalled; the reveal rules read
	   the runtime data-in attribute and so are wrapped in :global(), pinned under
	   .circle so they never leak. (See asia-home-motion memory.) */

	/* Hero entry — off-states. */
	.ht-rise {
		opacity: 0;
		transform: translateY(22px);
		transition:
			opacity 0.8s var(--ease-circle) var(--d, 0s),
			transform 0.8s var(--ease-circle) var(--d, 0s);
	}
	.ht-in {
		transform: translateY(110%);
		transition: transform 0.9s var(--ease-circle) var(--d, 0s);
	}
	.ht-card {
		opacity: 0;
		transform: translateY(30px) scale(0.96);
		transition:
			opacity 1s var(--ease-circle) 0.3s,
			transform 1s var(--ease-circle) 0.3s;
	}
	.circle.entered .ht-rise {
		opacity: 1;
		transform: translateY(0);
	}
	.circle.entered .ht-in {
		transform: translateY(0);
	}
	.circle.entered .ht-card {
		opacity: 1;
		transform: translateY(0) scale(1);
	}

	/* Scroll reveals — off-states (static class match is fine for the base). */
	.circle :global([data-reveal]) {
		opacity: 0;
		transition:
			opacity 0.8s var(--ease-circle) var(--rd, 0s),
			transform 0.8s var(--ease-circle) var(--rd, 0s);
		will-change: opacity, transform;
	}
	.circle :global([data-reveal='rise']) {
		transform: translateY(28px);
	}
	.circle :global([data-reveal='card']) {
		transform: translateY(26px) scale(0.97);
	}
	/* Settled — runtime data-in; MUST be :global or it's tree-shaken away. */
	.circle :global([data-reveal][data-in]) {
		opacity: 1;
		transform: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.ht-rise,
		.ht-in,
		.ht-card,
		.circle :global([data-reveal]) {
			transition: none;
			opacity: 1;
			transform: none;
		}
		.card-sheen {
			animation: none;
			opacity: 0;
		}
	}
</style>
