<script lang="ts">
	// Each house's menus as a 3D coverflow carousel (replaces the menu spreads on /fusion and /asia).
	// Reads the same editable menu list as before (data.menuIndex), so menus added or
	// removed in the admin still show up. Menus with cover artwork in
	// static/images/menus/ show it; the rest get a cream cover with the Geisha G.
	// Coverflow: each card tilts 30deg per slide of distance from the centre and steps
	// back 100px; ~4 cards across on desktop; only the centre card shows its title and
	// "View menu" button. Drag, arrow buttons and arrow keys all move it. No dependencies.
	import { onMount } from 'svelte';

	type MenuEntry = { slug: string; title: string; pdf?: string | null };
	type Brand = 'fusion' | 'asia';
	let {
		menus,
		startSlug = 'main',
		brand = 'fusion'
	}: { menus: MenuEntry[]; startSlug?: string; brand?: Brand } = $props();

	// Cover artwork per house, matched by a keyword in the menu's slug or title
	// (first match wins, so the more specific keys come first).
	const FUSION_ART: { key: string; src: string; alt: string }[] = [
		{ key: 'christmas', src: '/images/menus/christmas.webp', alt: 'Festive Christmas Menu cover' },
		{ key: 'special', src: '/images/menus/special.webp', alt: 'Special Menu cover with cherry blossom' },
		{ key: 'sunday', src: '/images/menus/sunday.webp', alt: 'Sunday Menu cover with a roast dinner' },
		{ key: 'dessert', src: '/images/menus/dessert.webp', alt: 'Dessert Menu cover with cherry blossom' },
		{ key: 'brunch', src: '/images/menus/brunch.webp', alt: 'Bottomless Brunch cover with cherry blossom' },
		{ key: 'drink', src: '/images/menus/drinks.webp', alt: 'Drinks Menu cover with cherry blossom' },
		{ key: 'kids', src: '/images/menus/kids.webp', alt: 'Kids Menu cover with cherry blossom' },
		{ key: 'allergen', src: '/images/menus/allergens.webp', alt: 'Allergens & Dietary cover with cherry blossom' },
		{ key: 'main', src: '/images/menus/main.webp', alt: 'Main Menu cover with cherry blossom' }
	];
	const ASIA_ART: { key: string; src: string; alt: string }[] = [
		{ key: 'evening', src: '/images/asia/menus/evening.webp', alt: 'Evening Special cover with a geisha among red blossom' },
		{ key: 'daytime', src: '/images/asia/menus/daytime.webp', alt: 'Daytime Special cover with a geisha among red blossom' },
		{ key: 'cocktail', src: '/images/asia/menus/cocktails.webp', alt: '2 for £14 Cocktails cover' },
		{ key: 'brunch', src: '/images/asia/menus/brunch.webp', alt: 'Bottomless Brunch cover' },
		{ key: 'kids', src: '/images/asia/menus/kids.webp', alt: 'Kids Menu cover' },
		{ key: 'drink', src: '/images/asia/menus/drinks.webp', alt: 'Drinks Menu cover beneath red lanterns' },
		{ key: 'allergen', src: '/images/asia/menus/allergens.webp', alt: 'Allergens & Dietary cover' },
		{ key: 'main', src: '/images/asia/menus/main.webp', alt: 'Main Menu cover with a geisha in pink blossom' }
	];
	const ART = $derived(brand === 'asia' ? ASIA_ART : FUSION_ART);
	const LEDE: Record<Brand, string> = {
		fusion: 'From stone-baked pizza to a proper Sunday roast.',
		asia: 'From sushi and dim sum to the robata grill.'
	};
	const artFor = (m: MenuEntry) => {
		const hay = `${m.slug} ${m.title}`.toLowerCase();
		return ART.find((a) => hay.includes(a.key));
	};

	// The start menu (Main Menu) is moved to the MIDDLE of the row and the
	// carousel opens on it, so there are covers on both sides from the first
	// frame — no empty stretch on the left.
	const ordered = $derived.by(() => {
		const exact = menus.findIndex((m) => m.slug === startSlug);
		const i = exact >= 0 ? exact : menus.findIndex((m) => `${m.slug} ${m.title}`.toLowerCase().includes(startSlug));
		if (i < 0) return menus;
		const rest = menus.filter((_, j) => j !== i);
		const mid = Math.floor(rest.length / 2);
		return [...rest.slice(0, mid), menus[i], ...rest.slice(mid)];
	});
	const items = $derived(
		ordered.map((m) => ({
			...m,
			href: m.pdf || `/${brand}/menus/${m.slug}`,
			external: !!m.pdf,
			art: artFor(m)
		}))
	);

	let viewport: HTMLElement;
	let track: HTMLElement;
	let pos = $state(0);
	let active = $derived(Math.round(pos));
	let W = $state(0);
	let slideW = $state(300);
	let cardH = $state(440);
	const GAP = 20;
	let target = 0;
	let anim = 0;
	let reduce = false;

	const clampPos = (p: number) => Math.max(0, Math.min(items.length - 1, p));
	const slideStyle = (i: number, p: number) => {
		const o = p - i;
		return `width:${slideW}px;transform:translate3d(0,0,${-Math.abs(o) * 100}px) rotateY(${o * 30}deg);z-index:${100 - Math.round(Math.abs(o) * 10)}`;
	};
	const trackX = $derived((W - slideW) / 2 - pos * (slideW + GAP));

	function goTo(i: number) {
		target = clampPos(i);
		if (reduce) { pos = target; return; }
		cancelAnimationFrame(anim);
		const from = pos, t0 = performance.now(), dur = 600;
		const tick = (t: number) => {
			const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
			pos = from + (target - from) * e;
			if (k < 1) anim = requestAnimationFrame(tick);
		};
		anim = requestAnimationFrame(tick);
	}

	function layout() {
		W = viewport.clientWidth;
		const spv = W >= 1366 ? 4.2 : W >= 1024 ? 3.2 : W >= 768 ? 2.5 : 1.25;
		slideW = (W - GAP * (Math.ceil(spv) - 1)) / spv;
		cardH = W >= 1366 ? Math.min(W * 0.33, 600) : W >= 1024 ? W * 0.45 : W >= 768 ? W * 0.6 : Math.min(innerHeight * 0.62, slideW * 1.45);
	}

	// drag / swipe with a little momentum, then snap
	let down = false, moved = false, startX = 0, startPos = 0, lastX = 0, lastT = 0, vel = 0;
	function onDown(e: PointerEvent) {
		if (e.button !== 0) return;
		down = true; moved = false; startX = lastX = e.clientX; lastT = performance.now(); startPos = pos; vel = 0;
		cancelAnimationFrame(anim);
		// NOT captured here: with pointer capture taken on press, a desktop click is
		// retargeted to the viewport, so "View menu" and the side cards never got
		// their click. Capture only once the pointer has actually moved (a drag).
	}
	function onMove(e: PointerEvent) {
		if (!down) return;
		const dx = e.clientX - startX;
		if (!moved && Math.abs(dx) > 4) {
			moved = true;
			try { viewport.setPointerCapture(e.pointerId); } catch {}
		}
		const now = performance.now();
		vel = (e.clientX - lastX) / Math.max(1, now - lastT); lastX = e.clientX; lastT = now;
		let p = startPos - dx / (slideW + GAP);
		const max = items.length - 1;
		if (p < 0) p *= 0.35;
		if (p > max) p = max + (p - max) * 0.35;
		pos = p; target = p;
	}
	function onUp(e?: PointerEvent) {
		if (!down) return;
		down = false;
		if (e && viewport.hasPointerCapture?.(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
		// a plain click (no drag) leaves the carousel where it is; the click handler decides
		if (!moved) return;
		goTo(Math.round(pos - (vel * 180) / (slideW + GAP)));
	}
	// clicking a side card brings it to the centre; a click that ends a drag is swallowed
	function onClickCapture(e: MouseEvent) {
		if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
		const slide = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
		if (!slide) return;
		const i = Number(slide.dataset.i);
		if (i !== active) { e.preventDefault(); goTo(i); }
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(Math.round(target) - 1); }
		if (e.key === 'ArrowRight') { e.preventDefault(); goTo(Math.round(target) + 1); }
	}

	onMount(() => {
		reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const exact = items.findIndex((m) => m.slug === startSlug);
		const start = exact >= 0 ? exact : items.findIndex((m) => `${m.slug} ${m.title}`.toLowerCase().includes(startSlug));
		pos = target = start >= 0 ? start : Math.floor(items.length / 2);
		const ro = new ResizeObserver(layout);
		ro.observe(viewport);
		layout();
		return () => { ro.disconnect(); cancelAnimationFrame(anim); };
	});
</script>

<section class="menus" id="menu" data-brand={brand} aria-labelledby="menus-title">
	<p class="bigword" aria-hidden="true">MENUS</p>
	<div class="intro">
		<span class="eyebrow">Explore Our Menu</span>
		<h2 id="menus-title">Have a look at the menu</h2>
		<p>{LEDE[brand]} Drag through the menus and open the one you fancy, or <a href="/{brand}/menus">browse every menu</a>.</p>
	</div>

	<div
		class="viewport"
		bind:this={viewport}
		style="--card-h:{cardH}px"
		tabindex="0"
		role="region"
		aria-roledescription="carousel"
		aria-label="Menus"
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointercancel={onUp}
		onclickcapture={onClickCapture}
		onkeydown={onKey}
	>
		<div class="track" bind:this={track} style="transform:translate3d({trackX}px,0,0)">
			{#each items as m, i (m.slug)}
				<div
					class="slide"
					class:active={i === active}
					data-i={i}
					style={slideStyle(i, pos)}
					role="group"
					aria-roledescription="slide"
					aria-label="{i + 1} of {items.length}: {m.title}"
					aria-hidden={i !== active}
				>
					<div class="card">
						<span class="outline" aria-hidden="true"></span>
						<div class="panel">
							{#if m.art}
								<img class="art" src={m.art.src} alt={m.art.alt} width="800" height="1200" loading="lazy" decoding="async" draggable="false" />
							{:else}
								<div class="cover">
									<img src="/images/brand/geisha-g-ink.webp" alt="" width="394" height="600" draggable="false" />
									<b>{m.title}</b>
									<i></i>
								</div>
							{/if}
						</div>
						<p class="name">{m.title}</p>
						<div class="btnbox">
							<a class="btn dark" href={m.href} target={m.external ? '_blank' : undefined} rel={m.external ? 'noopener' : undefined} tabindex={i === active ? 0 : -1}>View menu</a>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="controls">
		<button class="arrow" type="button" aria-label="Previous menu" onclick={() => goTo(Math.round(target) - 1)}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M15 5l-7 7 7 7" /></svg>
		</button>
		<span class="count" aria-live="polite"><b>{String(active + 1).padStart(2, '0')}</b> / {String(items.length).padStart(2, '0')}</span>
		<button class="arrow" type="button" aria-label="Next menu" onclick={() => goTo(Math.round(target) + 1)}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 5l7 7-7 7" /></svg>
		</button>
	</div>
</section>

<style>
	.menus {
		--lacquer: #0c1410;
		--ink: #0a0d0b;
		--rice: #f2ece0;
		--paper: #f8f4f0;
		--sage: #9fb0a8;
		--ember: #dd8236;
		--hair: rgba(242, 236, 224, 0.22);
		--mincho: 'Shippori Mincho', Georgia, 'Times New Roman', serif;
		--jost: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.215, 0.61, 0.355, 1);
		position: relative;
		overflow: hidden;
		padding-block: clamp(88px, 10vw, 150px) clamp(72px, 8vw, 120px);
		color: var(--rice);
		font-family: var(--jost);
		font-weight: 300;
		background:
			radial-gradient(40% 50% at 12% 100%, rgba(221, 130, 54, 0.14), transparent 70%),
			radial-gradient(40% 40% at 90% 0%, rgba(91, 163, 240, 0.06), transparent 70%),
			var(--lacquer);
	}
	.menus[data-brand='asia'] {
		--lacquer: #131316;
		--ink: #08080b;
		--rice: #f5f1e8;
		--paper: #f8f4f0;
		--sage: #a3a0a0;
		--ember: #d4af37;
		--hair: rgba(245, 241, 232, 0.22);
		background:
			radial-gradient(40% 50% at 12% 100%, rgba(212, 175, 55, 0.12), transparent 70%),
			radial-gradient(40% 40% at 90% 0%, rgba(239, 60, 92, 0.08), transparent 70%),
			var(--lacquer);
	}
	.bigword { position: absolute; left: 50%; top: clamp(20px, 3vw, 48px); transform: translateX(-50%); margin: 0; font-family: var(--mincho); font-weight: 600; font-size: clamp(120px, 24vw, 420px); line-height: 1; letter-spacing: 0.02em; color: transparent; -webkit-text-stroke: 1.5px rgba(242, 236, 224, 0.13); white-space: nowrap; pointer-events: none; user-select: none; }
	.intro { position: relative; z-index: 1; max-width: 560px; margin: 0 auto clamp(48px, 6vw, 80px); padding-inline: 16px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 18px; }
	.eyebrow { font-size: 11px; font-weight: 400; letter-spacing: 0.32em; text-transform: uppercase; color: var(--ember); }
	.intro h2 { margin: 0; font-family: var(--mincho); font-weight: 600; font-size: clamp(34px, 4.2vw, 56px); line-height: 1.08; text-wrap: balance; }
	.intro p { margin: 0; color: var(--sage); max-width: 46ch; line-height: 1.6; }
	.intro a { color: var(--rice); }

	.btn { position: relative; overflow: hidden; isolation: isolate; display: inline-flex; align-items: center; justify-content: center; gap: 12px; font-family: var(--jost); font-size: 11.5px; font-weight: 500; letter-spacing: 0.24em; text-transform: uppercase; text-decoration: none; padding: 12px 26px; border: 1px solid var(--ink); border-radius: 100px; color: var(--ink); background: rgba(248, 244, 240, 0.92); cursor: pointer; transition: color 0.45s var(--ease); width: 100%; }
	.btn::before { content: ''; position: absolute; inset: 0; z-index: -1; background: var(--ink); transform: translateY(101%); transition: transform 0.5s var(--ease); }
	.btn:hover, .btn:focus-visible { color: var(--paper); outline: none; }
	.btn:hover::before, .btn:focus-visible::before { transform: none; }

	.viewport { position: relative; z-index: 1; perspective: 2000px; overflow: hidden; padding-block: 40px; touch-action: pan-y; cursor: grab; outline: none; }
	.viewport:active { cursor: grabbing; }
	.viewport:focus-visible { box-shadow: inset 0 0 0 2px rgba(221, 130, 54, 0.5); }
	.track { display: flex; gap: 20px; transform-style: preserve-3d; will-change: transform; }
	.slide { flex: none; transform-style: preserve-3d; will-change: transform; }
	.card { position: relative; height: var(--card-h); transform-style: preserve-3d; display: flex; align-items: center; justify-content: center; }
	.outline { position: absolute; inset: 0; border: 1.5px solid rgba(242, 236, 224, 0.75); border-radius: 20px; transform: translateZ(-30px) scale(0.99); pointer-events: none; }
	.panel { position: absolute; inset: 0; border-radius: 20px; background: var(--paper); overflow: clip; display: grid; place-items: center; }
	.art { width: 78%; height: 78%; object-fit: contain; filter: drop-shadow(0 18px 28px rgba(0, 0, 0, 0.28)); pointer-events: none; user-select: none; }
	.cover { width: 78%; height: 72%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; color: var(--ink); border: 1px solid rgba(10, 13, 11, 0.12); border-radius: 6px; padding: 20px; background: linear-gradient(180deg, #fbf8f4, #f3eee6); }
	.cover img { height: 30%; width: auto; pointer-events: none; }
	.cover b { font-family: var(--mincho); font-weight: 600; font-size: clamp(20px, 1.7vw, 28px); line-height: 1.1; }
	.cover i { width: 28px; height: 1px; background: var(--ember); }
	.name { position: absolute; top: 22px; left: 20px; right: 20px; margin: 0; text-align: center; font-weight: 500; font-size: 12px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--ink); opacity: 0; transform: translateY(-30px); transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out; z-index: 1; }
	.btnbox { position: absolute; left: 20px; right: 20px; bottom: 20px; opacity: 0; transform: translateY(30px); transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out; z-index: 1; pointer-events: none; }
	.slide.active .name, .slide.active .btnbox { opacity: 1; transform: none; }
	.slide.active .btnbox { pointer-events: auto; }

	.controls { position: relative; z-index: 1; display: flex; justify-content: center; align-items: center; gap: 22px; margin-top: 20px; }
	.arrow { width: 52px; height: 52px; border-radius: 50%; border: 1px solid var(--hair); background: transparent; color: var(--rice); display: grid; place-items: center; cursor: pointer; transition: border-color 0.35s var(--ease), background 0.35s var(--ease); }
	.arrow:hover, .arrow:focus-visible { border-color: var(--rice); background: rgba(242, 236, 224, 0.06); outline: none; }
	.arrow svg { width: 18px; height: 18px; }
	.count { font-size: 12px; letter-spacing: 0.24em; color: var(--sage); font-variant-numeric: tabular-nums; min-width: 72px; text-align: center; }
	.count b { color: var(--rice); font-weight: 500; }

	/* ---- phones ----
	   767px is layout()'s own break (1.25 slides below 768). Both houses: the
	   geometry is the same, only the colours and the lede differ. */
	@media (max-width: 767px) {
		/* Desktop spacing put the button under the fold: heading, cover and button
		   now share one phone screen. The side cards tilt BACK in Z, so they are
		   never more than a few px taller than the centre card — 28px still clears. */
		.menus { padding-block: 64px 56px; }
		.intro { margin-bottom: 20px; }
		/* the link stays whole: at 430 it broke as "browse every / menu." */
		.intro a { white-space: nowrap; }
		.viewport { padding-block: 28px; }
		/* the 120px minimum made the word 495px wide on a 390 screen: it read "ENU" */
		.bigword { font-size: 22vw; }
		/* width: 100% plus padding and border on a content-box anchor made the pill
		   54px wider than its box, so it ran out past the card's right edge. It does
		   the same on a wide screen — left as it is there until the owner says. */
		.btn { box-sizing: border-box; min-height: 44px; }
		/* The cover stands between the name and the pill instead of under the pill:
		   48px clears the name line (22 + 17 + air), 76px the pill (20 + 44 + 12).
		   --card-h, not 100%: the panel's grid row is sized from the picture's own
		   shape, so a percentage ran the cover under the pill on a short screen
		   (375x553) and on a wide one (720px), where the row is taller than the card. */
		.art, .cover { align-self: start; margin-top: 48px; height: calc(var(--card-h) - 48px - 76px); }
		/* …and the no-artwork cover's own padding and border count inside that */
		.cover { box-sizing: border-box; }
	}

	/* On a phone proper the 22vw word's feet reached the top of Fusion's heading
	   (6px into it at 430). Capped, it clears by 8px with the eyebrow still
	   centred in it; above 480 the heading sits properly inside the word. */
	@media (max-width: 480px) {
		.menus[data-brand='fusion'] .bigword { font-size: min(22vw, 80px); }
	}

	@media (prefers-reduced-motion: reduce) {
		.name, .btnbox { transition: none; }
	}
</style>
