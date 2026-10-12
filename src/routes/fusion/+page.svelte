<script lang="ts">
	// Geisha Fusion home page — the 2026 redesign.
	//
	// This is a COMPLETE replacement of the old Gucci-Osteria layout (arched hero
	// with flanking justified columns, the spinning PlateMotif orbit, RuledSection
	// bands and the <FrameGrid> ledger rules). None of it survives: Fusion now runs
	// the same editorial structure as Asia — hero, story, specials, mural band, menu,
	// reserve, info strip — in its own palette.
	//
	// What differs from Asia, deliberately:
	//   · the hero copy sits on the RIGHT. Fusion's artwork puts its face hard left,
	//     so Asia's left rail would have printed the headline over her eyes. The
	//     scrim is mirrored to match.
	//   · the menu section is a card grid off the live menu list, not a pair of
	//     rasterised spreads — Fusion's menu has no A3 artwork to photograph.
	//   · teal (--teal) is the second accent, used where Asia uses more gold.
	import { getBrand } from '$lib/data/brand';
	import { imgAttrs } from '$lib/media/responsive';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import BannerHero from '$lib/components/BannerHero.svelte';
	import HomeSections from '$lib/components/HomeSections.svelte';
	import HomeCards from '$lib/components/HomeCards.svelte';
	import RestaurantSchema from '$lib/components/RestaurantSchema.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import FusionMenuCarousel from '$lib/components/FusionMenuCarousel.svelte';
	import FusionInteriors from '$lib/components/FusionInteriors.svelte';
	import FusionMarquee from '$lib/components/FusionMarquee.svelte';
	import { inviewVideo } from '$lib/data/showcase';
	import { onMount } from 'svelte';
	import { isCovered, isEntering } from '$lib/nav/entering';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	import ShowcaseDoorway from '$lib/components/showcase/ShowcaseDoorway.svelte';
	import { menuFileKind } from '$lib/data/menu-types';

	let { data }: { data: PageData } = $props();
	// Editable copy (with static defaults) + merged brand facts for the Visit block.
	const home = $derived(data.home);
	const info = $derived(data.brandInfo);
	const extra = $derived(data.homeExtra); // marquee words + walk-ins note (editable)
	const brand = getBrand('fusion');

	// Compact hours for the Visit block, from the LIVE service periods (layout
	// load → data.hours), so this can't disagree with the diary. `compact` already
	// merges consecutive days with identical hours; when that collapses to a
	// single group covering the whole week we label it "Open Daily".
	const hours = $derived(data.hours);
	const hoursSummary = $derived(
		hours.compact.length === 1 && hours.compact[0].hours !== 'Closed'
			? [{ day: 'Open Daily', hours: hours.compact[0].hours }]
			: hours.compact
	);

	// ===== MOTION =====
	// Staged hero entry — flipped one frame after mount so the CSS transitions run
	// from their "off" state (a double rAF guarantees the off-state paints once first;
	// a single rAF can be coalesced with the initial paint and skip the animation).
	// Reduced-motion users start already-entered (no movement).
	let entered = $state(false);

	// Did we arrive from the front door? Then the layout's shoji panels are covering
	// this hero and about to part — so the hero must NOT also run its own curtain,
	// and its copy must rise WHILE the panels open rather than after. Read at
	// component init: the layout consumes the flag in its onMount, and a child's
	// init runs before its parent's onMount, so this is always seen.
	const fromLanding = isEntering();

	// Same story for an intra-Fusion navigation: BrandPageCurtain has dipped the
	// screen to dark, swapped the page behind it and is about to lift. Playing the
	// hero's own curtain under that lift would be two covers in series.
	const covered = fromLanding || isCovered();

	onMount(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		// --- Scroll reveals: one IntersectionObserver tags [data-reveal] nodes with
		// `data-in` as they enter, then unobserves. All the actual motion is CSS keyed
		// off [data-reveal][data-in], tailored per section shape (see the style block). ---
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

		// NOTE: the hero artwork is deliberately NOT parallaxed — any drift needs an
		// oversized scale() to cover the gap it opens, and that re-crops the frame.

		if (reduce) {
			entered = true;
			return () => io?.disconnect();
		}

		// --- Story section: scroll-driven unfurl + ring growth.
		// One rAF-throttled handler MEASURES the section and writes two custom
		// properties, each straight onto the one element that reads it (see the
		// note on `ringsHero` below for why not onto the section):
		//   --p  0→1 as the section crosses the viewport. Feeds the rings, which swell
		//        from a tight cluster to their full span the whole way through.
		//   --o  0→1 eased "open" ramp. Feeds the picture's clip wipe, and is
		//        deliberately monotonic and settled by mid-entry — a mask driven off
		//        raw --p would re-close as the section left the screen.
		// Neither effect is Asia's (it pans a still inside a fixed window so the
		// visible CROP changes), and neither is the drift+scale this replaced: a mask
		// retracting off the page edge moves nothing and can't re-crop the frame.
		// The hero rings ride the same idea on a different clock (--hp): the hero is
		// already at the top of the page, so there's no "crossing the viewport" to
		// measure — it runs 0 while the hero is parked and 1 once it has scrolled
		// fully past, which is what makes the cluster open out as you leave.
		const story = document.querySelector<HTMLElement>('.about');
		const heroEl = document.querySelector<HTMLElement>('.hero');
		// The sections are what gets MEASURED; these are what gets WRITTEN. Custom
		// properties inherit, so setting --hp on .hero (or --p / --o on .about)
		// restyled that section's whole subtree — headline, copy, buttons — on
		// every scroll frame, for the sake of one SVG. Measured on a throttled
		// phone: 16.0 → 9.9ms a frame through the hero and 18.6 → 9.3ms through
		// the story once the write lands on the consumer alone. Each property has
		// exactly one reader in this file's CSS; if a second is ever added, write
		// it there too rather than moving the write back up to the section.
		const ringsHero = document.querySelector<SVGElement>('.rings-hero');
		const ringsStory = document.querySelector<SVGElement>('.rings-about');
		const storyImg = document.querySelector<HTMLElement>('.about-media .dish-frame');
		// At phone width the picture's clip wipe is switched off in CSS (it was
		// over before the picture reached the screen), so --o has no reader there.
		const stacked = window.matchMedia('(max-width: 760px)');
		let storyFrame = 0;
		// Whether each section is on (or within a quarter-screen of) the screen — see
		// the `near` observer below. Both start true so the first track() measures both.
		let heroNear = true;
		let storyNear = true;
		const track = () => {
			storyFrame = 0;
			const vh = window.innerHeight || 1;
			// Both rects are READ before either section is written to. Interleaved
			// (read hero, write --hp, read story) the second read forced a style
			// recalc in the middle of every scroll frame. And a section that is nowhere
			// near the screen is not measured at all: this page is fifteen screens
			// long on a phone and both effects are over inside the first four.
			const hr = heroEl && heroNear ? heroEl.getBoundingClientRect() : null;
			const r = story && storyNear ? story.getBoundingClientRect() : null;
			if (hr) {
				ringsHero?.style.setProperty(
					'--hp',
					Math.min(1, Math.max(0, -hr.top / (hr.height || vh))).toFixed(4)
				);
			}
			if (!r) return;
			// 0 as the section's top reaches the bottom edge, 1 as its bottom clears the top.
			const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
			// easeOutCubic over the entry third, so the wipe decelerates into place
			// rather than tracking the wheel linearly all the way across.
			const raw = Math.min(1, Math.max(0, (p - 0.1) / 0.32));
			ringsStory?.style.setProperty('--p', p.toFixed(4));
			if (!stacked.matches) {
				storyImg?.style.setProperty('--o', (1 - Math.pow(1 - raw, 3)).toFixed(4));
			}
		};
		const onScroll = () => {
			if (!storyFrame) storyFrame = requestAnimationFrame(track);
		};
		track();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
		// The quarter-screen margin means a section is being tracked again before
		// any of it shows, and has been written its clamped end value (0 or 1)
		// before it stops being tracked — so nothing is ever left part-way.
		const near = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.target === heroEl) heroNear = e.isIntersecting;
					else storyNear = e.isIntersecting;
				}
				onScroll();
			},
			{ rootMargin: '25% 0px' }
		);
		if (heroEl) near.observe(heroEl);
		if (story) near.observe(story);

		// Double rAF — see note above.
		let id2 = 0;
		const id1 = requestAnimationFrame(() => {
			id2 = requestAnimationFrame(() => (entered = true));
		});
		return () => {
			cancelAnimationFrame(id1);
			cancelAnimationFrame(id2);
			if (storyFrame) cancelAnimationFrame(storyFrame);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			near.disconnect();
			io?.disconnect();
		};
	});

	// Hero artwork + feature stills — editable from admin → Content → Media (with the
	// original assets as fallback). Full-bleed bands break up the page.
	const blossomImage = $derived(data.media.blossomImage);

	// Resolve each slot to its optimized AVIF/WebP ladder. A CMS-uploaded URL that
	// has no variants passes straight through.
	// The hero is a ~1.88:1 landscape painting covering a PORTRAIT frame on a phone,
	// so it is scaled to the frame's HEIGHT and renders about 1.9 screen-heights
	// wide — four times the viewport width. Told '100vw', a phone picked the 1024px
	// rung and stretched it ~3x; the crackle in the face went to mush. The portrait
	// hint makes it take the 1600px rung instead (+68 KB) and changes nothing in
	// landscape, where 100vw is still the truth.
	// The photographs below the first screen tell a phone they are 85vw wide when
	// they are in fact full width. A 3x phone multiplies the stated width by three,
	// so "100vw" made it fetch the 1600px variant (up to 360 KB a picture) for a
	// screen 1170 device px across; at 85vw it takes the 1024px one — under half
	// the bytes, and not a difference the eye finds. 2x phones are unaffected.
	const PHONE_CAP = '(max-width: 760px) 85vw';
	// The hero is the warm-lit dining room under the pink blossom (owner, Oct 2026),
	// shipped with the site rather than read from the CMS slot.
	const hero = {
		src: '/images/hero/fusion-blossom-1672.webp',
		srcset: '/images/hero/fusion-blossom-960.webp 960w, /images/hero/fusion-blossom-1672.webp 1672w',
		sizes: '(orientation: portrait) 190vh, 100vw',
		width: 1672,
		height: 941
	};
	const blossom = $derived(imgAttrs(blossomImage, `${PHONE_CAP}, 100vw`));

	// Shared pool for the specials slider: an offer with no artwork of its own
	// borrows a food shot from the gallery so a slide is never a bare gradient.
	const foodPool = $derived.by(() => {
		const food = data.gallery.filter((g) => g.category === 'food');
		return food.length ? food : data.gallery;
	});

	// The "Our Story" stat strip (days open / kitchen hours / menus to explore) was
	// removed, along with the daysOpen + kitchenSpan derivations and the shortTime
	// helper that fed it. `hours` is still used further down, so it stays.

	// ===== SPECIALS SLIDER =====
	// One slide per live offer (the same list the What's On page and the admin
	// Offers editor use). An offer with no image of its own borrows from the
	// gallery so a slide is never a bare gradient.
	// Poster artwork for offers whose saved copy has no picture of its own (the
	// live content can predate the artwork) — matched by offer id or title.
	const POSTERS: Record<string, string> = {
		special: '/images/specials/fusion-special-menu.webp',
		'special menu': '/images/specials/fusion-special-menu.webp',
		brunch: '/images/specials/fusion-bottomless-brunch.webp',
		'bottomless brunch': '/images/specials/fusion-bottomless-brunch.webp'
	};
	const withPoster = (o: (typeof data.offers)[number]) => {
		if (o.img) return o;
		const art = POSTERS[o.id] ?? POSTERS[(o.title ?? '').toLowerCase()];
		return art ? { ...o, img: art, imgFit: 'poster' as const } : o;
	};
	const specials = $derived(
		data.offers.map(withPoster).map((o, i) => ({
			...o,
			image: o.img || foodPool[i % Math.max(foodPool.length, 1)]?.src || '',
			// Only real artwork can be a poster — a borrowed gallery photo carries no
			// wording, so it must never suppress the title/blurb.
			poster: o.imgFit === 'poster' && !!o.img,
			// Borrowed = no artwork of its own. Those need a heavier scrim to stay
			// legible; artwork chosen for this banner does not (and is spoiled by one).
			borrowed: !o.img
		}))
	);
	let specialIndex = $state(0);
	let specialsPaused = $state(false);

	// The slide being covered — it stays visible under the incoming wipe.
	let prevSpecial = $state(-1);
	function goSpecial(i: number) {
		const n = specials.length;
		if (!n) return;
		const next = ((i % n) + n) % n;
		if (next === specialIndex) return;
		prevSpecial = specialIndex;
		specialIndex = next;
	}

	// Is the banner on screen? It sits four screens down a phone page, and the
	// timer used to run from page load regardless — crossfading full-bleed slides
	// nobody could see, and leaving a guest who scrolled down to it on whichever
	// slide the clock happened to have reached, a second from changing. Now the
	// 7s starts when a quarter of it is in view and stops when it leaves.
	let specialsEl = $state<HTMLElement>();
	let specialsOnScreen = $state(false);
	$effect(() => {
		if (!specialsEl) return;
		const seen = new IntersectionObserver(([e]) => (specialsOnScreen = e.isIntersecting), {
			threshold: 0.25
		});
		seen.observe(specialsEl);
		return () => seen.disconnect();
	});

	// Autoplay: 7s a slide, held while the pointer/focus is inside the banner or
	// the banner is off screen, and switched off entirely under reduced motion.
	$effect(() => {
		if (specialsPaused || !specialsOnScreen || specials.length < 2) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// Restarts on every change, so a manual click gets a full 7s (and the
		// tab's progress bar, which runs on the same 7s, stays in step).
		const at = specialIndex;
		const id = setTimeout(() => goSpecial(at + 1), 7000);
		return () => clearTimeout(id);
	});
</script>

<!-- Hours in the description come from the live service periods, not a
     hardcoded string, so search snippets track the diary. -->
<Seo
	title="Geisha Fusion — Flavours from every corner"
	description="Geisha Fusion, Benton. A family-friendly restaurant where the world's favourite dishes meet — burgers, curry, fresh pizza and a proper Sunday roast.{hours.strap
		? ` ${hours.strap}.`
		: ''}"
/>

<!-- The type pair is linked once in fusion/+layout.svelte so every Fusion route
     has it — no per-page <link> here (that's what left the shared chrome on
     system-ui on pages that forgot). -->

<RestaurantSchema {brand} reviews={data.reviews} {hours} />

<div class="page" data-brand="fusion">
	<!-- HERO — full-bleed artwork, copy stacked RIGHT over a horizontal ink scrim.
	     The wordmark sits at the head of the copy stack. A staged entry animation
	     runs on load (curtain lifts → wordmark → eyebrow → title lines clip-rise →
	     lede → actions → scroll cue). -->
	<section class="hero" class:enter={entered} class:from-landing={covered}>
		<!-- Only for a direct visit or a hard refresh. Arriving from the front door
		     the layout's shoji panels are the curtain, and arriving from another
		     Fusion page the dip already is — both suppress this one. -->
		{#if !covered}
			<div class="hero-curtain" aria-hidden="true"></div>
		{/if}

		<!-- HERO — the Fusion artwork, actually shown.
		     The template's concentric rings and lit disc were tried over this image
		     and taken out again: the artwork is already a busy composition (cracked
		     porcelain face left, red ring centre, lanterns right) and the line-work
		     fought it instead of framing it, while the scrim needed to seat left-hand
		     copy over the face buried the picture entirely.
		     What's left is a poster treatment — the image runs clean across the whole
		     fold and the copy sits in a band along the BOTTOM, so nothing is printed
		     across the face. That bottom-anchored stack is also what keeps this from
		     reading as Asia's hero, which centres its copy on a left rail. -->
		<div class="hero-bg">
			<img {...hero} alt="" fetchpriority="high" />
			<!-- The warm wash + ring cluster, on the RIGHT half only. In the template
			     these sit on empty ground with the copy off to the other side; here the
			     copy shares that half, so the rings are pitched faint enough to read as
			     atmosphere behind the type. They are kept off the left half entirely —
			     that's where the face is, and over it they just fought the artwork. -->
			<div class="glow glow-hero" aria-hidden="true"></div>
			<svg
				class="rings rings-hero"
				viewBox="0 0 600 600"
				preserveAspectRatio="xMidYMid meet"
				aria-hidden="true"
			>
				<circle cx="300" cy="300" r="290" fill="none" stroke="#dd8236" stroke-width="1" />
				<circle cx="300" cy="300" r="215" fill="none" stroke="#f79a4a" stroke-width="1" />
				<circle cx="300" cy="300" r="140" fill="none" stroke="#f79a4a" stroke-width="1" />
			</svg>
		</div>

		<div class="hero-inner">
			<div class="hero-copy">
				<span class="hero-eyebrow">{home.heroEyebrow}</span>
				<h1 class="hero-title">
					{#each home.heroTitleLines as line}
						<span class="ht-line"><span class="ht-in"><RichText text={line} /></span></span>
					{/each}
				</h1>
				<p class="hero-line">{home.heroLine}</p>
				<div class="hero-actions">
					<a class="btn btn-solid" href={brand.bookingUrl}>Book a Table</a>
					<a class="btn" href="/fusion/menus">View the Menu</a>
				</div>
			</div>
		</div>

		<!-- The template's slide counter, kept as a static index mark. -->
		<div class="hero-dots" aria-hidden="true">
			<span>01</span><span class="line"></span><span>04</span>
		</div>

		<div class="scroll-cue" aria-hidden="true">
			<span>Scroll</span>
			<span class="stick"></span>
		</div>
	</section>

	<!-- ANNOUNCEMENT HERO — editable award/news banner (only when the venue enables its hero) -->
	<BannerHero banner={data.banner} />

	<!-- INSIDE — the premises and the food, straight under the hero. -->
	<ShowcaseDoorway {brand} />

	<!-- THE ROOM — copy left, the Interiors film centre stage, a drifting wall of
	     room photos and clips right (replaced the "Colour on every wall" still band).
	     See FusionInteriors. Sits ABOVE the story, straight after the Doorway. -->
	<FusionInteriors eyebrow={home.bandEyebrow} line={home.roomLine} bookingUrl={brand.bookingUrl} />
	<FusionMarquee
		items={['Lantern-lit', 'Blossom canopy', 'Street-art murals', 'Open kitchen', 'Cocktails', 'Family tables']}
	/>

	<!-- OUR STORY.
	     Deliberately NOT Asia's layout. Asia runs a bordered, matted frame with a
	     scroll-panned window and a plaque hanging off its corner, centred in a
	     symmetrical two-column grid. This is the opposite: an asymmetric spread
	     where the artwork BLEEDS off the right edge of the viewport with no frame,
	     no mat and no plaque, the copy holds a narrow left column, and the three
	     figures drop out of the copy into a full-width ruled strip across the foot
	     of the section. -->
	<section class="about" id="about">
		<div class="glow glow-about" aria-hidden="true"></div>
		<svg class="rings rings-about" viewBox="0 0 600 600" aria-hidden="true">
			<circle cx="300" cy="300" r="290" fill="none" stroke="#dd8236" stroke-width="1" />
			<circle cx="300" cy="300" r="210" fill="none" stroke="#5a9184" stroke-width="1" />
			<circle cx="300" cy="300" r="132" fill="none" stroke="#f79a4a" stroke-width="1" />
		</svg>

		<div class="about-grid">
			<div class="about-copy">
				<span class="eyebrow" data-reveal="rise">{home.aboutEyebrow}</span>
				<h2 data-reveal="words" aria-label={home.aboutTitle}>
					{#each home.aboutTitle.split(' ') as w, i}<span class="w" aria-hidden="true"
							><span class="wi" style="--i:{i}">{w}</span></span
						>{' '}{/each}
				</h2>
				<p data-reveal="rise" style="--rd: 0.1s"><RichText text={home.statementLead} /></p>
				<p data-reveal="rise" style="--rd: 0.15s"><RichText text={home.statementColLeft} /></p>
				<p data-reveal="rise" style="--rd: 0.2s"><RichText text={home.statementColRight} /></p>
				<p class="about-tag" data-reveal="rise" style="--rd: 0.25s">{home.aboutTag}</p>
			</div>

			<!-- The New Menu film, standing tall on its own beside the copy. It unveils
			     from the bottom as the section scrolls in (--o, from the handler in
			     onMount), inside an offset gold hairline frame. -->
			<div class="about-media" data-reveal="film">
				<span class="dish-outline" aria-hidden="true"></span>
				<div class="dish-frame">
					<video
						use:inviewVideo={{ fetchAt: '40% 0px' }}
						data-src="/videos/new-menu-dishes.mp4"
						data-poster="/videos/new-menu-dishes-poster.webp"
						muted
						loop
						playsinline
						preload="none"
						aria-label="Dishes from the new Geisha Fusion menu being served"
					></video>
				</div>
			</div>
		</div>

		<!-- The ruled figures strip that sat here (days open / kitchen hours / menus
		     to explore) is gone — see the Asia home page. The footer carries the
		     real hours. -->
	</section>


	<FusionMarquee
		variant="outline"
		reverse
		speed={0.7}
		items={['Special Menu', 'Sunday Roast', 'Bottomless Brunch', 'Restaurant Week', 'Festive Christmas Menu', 'Kids Menu', 'Dessert Menu']}
	/>

	<!-- SPECIALS — full-bleed cinematic banner, one slide per live offer. -->
	{#if specials.length}
		<section class="specials" id="specials" aria-label="What's on at Geisha Fusion">
			<div
				class="specials-slider"
				class:paused={specialsPaused}
				data-reveal="frame"
				bind:this={specialsEl}
				onmouseenter={() => (specialsPaused = true)}
				onmouseleave={() => (specialsPaused = false)}
				onfocusin={() => (specialsPaused = true)}
				onfocusout={() => (specialsPaused = false)}
				role="group"
			>
				{#each specials as s, i}
					<div
						class="special-slide"
						class:active={i === specialIndex}
						class:prev={i === prevSpecial && i !== specialIndex}
						class:poster={s.poster}
						class:borrowed={s.borrowed}
						aria-hidden={i !== specialIndex}
					>
						<div class="slide-bg">
							{#if s.image}
								<!-- Every picture is shown WHOLE — never cropped, never stretched. The
								     banner is 16:9, the shape of the poster artwork, so a poster fills
								     it exactly; a photo slide shows its photo complete beside the copy.
								     Any sliver the artwork doesn't cover is filled by this blurred copy
								     of the same file (same attrs, so it comes from cache). -->
								<img
									class="poster-fill"
									{...imgAttrs(s.image, `${PHONE_CAP}, 100vw`)}
									alt=""
									aria-hidden="true"
									loading={i === 0 ? 'eager' : 'lazy'}
								/>
								<img
									class="sharp"
									{...imgAttrs(s.image, `${PHONE_CAP}, 100vw`)}
									alt={s.poster ? `${s.title} — ${s.when}` : ''}
									loading={i === 0 ? 'eager' : 'lazy'}
								/>
							{/if}
						</div>
						<div class="special-copy">
							<div class="special-copy-inner">
								<!-- A poster already prints the offer's name, timing and terms, so
								     repeating them over the top would double the wording. -->
								{#if !s.poster}
									<span class="eyebrow">{s.when}</span>
									<h3>{s.title}</h3>
									<p>{s.blurb}</p>
								{/if}
								<a
									class="btn btn-solid"
									href={s.href ?? '/fusion/offers'}
									tabindex={i === specialIndex ? 0 : -1}
								>
									{s.cta || (s.price ? `View — ${s.price}` : 'View Offer')}
								</a>
							</div>
						</div>
					</div>
				{/each}

				<div class="specials-count" aria-hidden="true">
					{#key specialIndex}<span class="now">{String(specialIndex + 1).padStart(2, '0')}</span>{/key}
					<span class="of">/ {String(specials.length).padStart(2, '0')}</span>
				</div>

				<div class="specials-tabs">
					{#each specials as s, i}
						<button
							class:active={i === specialIndex}
							aria-label={s.title}
							aria-current={i === specialIndex}
							onclick={() => goSpecial(i)}
						></button>
					{/each}
				</div>

				<div class="specials-nav">
					<button aria-label="Previous special" onclick={() => goSpecial(specialIndex - 1)}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
							><path d="M15 6l-6 6 6 6" /></svg
						>
					</button>
					<button aria-label="Next special" onclick={() => goSpecial(specialIndex + 1)}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
							><path d="M9 6l6 6-6 6" /></svg
						>
					</button>
				</div>
			</div>
		</section>
	{/if}

	<!-- MENUS: 3D coverflow of the menus (see FusionMenuCarousel.svelte). -->
	<FusionMenuCarousel menus={data.menuIndex} />

	<!-- RESERVE — the call to action.
	     It sits HERE, straight off the menu band, rather than at the foot of the
	     page under the shared gallery/reviews sections. A guest who has just read
	     the menu is the one most likely to book, and this is the strongest piece of
	     artwork on the page — burying it below three more sections wasted both. -->
	<section class="reserve">
		<div class="reserve-bg">
			<img {...blossom} alt="" loading="lazy" />
		</div>
		<div class="reserve-inner" data-reveal="rise">
			<span class="eyebrow">Reserve Your Table</span>
			<h2>Book your table at {brand.name}</h2>
			<p>
				Join us for an unforgettable dining experience — we look forward to welcoming you to {info
					.address.line1}, {info.address.city}.
			</p>
			<a class="btn btn-solid" href={brand.bookingUrl}>Book Now</a>
			<!-- Only when there is a note: an empty <p> still carried its margin and
			     left the band 36px deeper under the button than above the eyebrow. -->
			{#if extra.walkinsNote}
				<p class="reserve-note"><em>{extra.walkinsNote}</em></p>
			{/if}
		</div>
	</section>
</div>

<!-- DENSITY SECTIONS (shared, real data) — gallery, reviews, order and Instagram.
     They take the new palette from the Fusion brand tokens. -->
<div data-brand="fusion">
	<HomeSections
		{brand}
		marqueeWords={extra.marqueeWords}
		offers={data.offers}
		reviews={data.reviews}
		gallery={data.gallery}
	>
		{#snippet galleryOverride()}
			<HomeCards {brand} />
		{/snippet}
	</HomeSections>
</div>

<div class="page" data-brand="fusion">
	<!-- INFO STRIP — visit, contact and the LIVE opening times -->
	<section class="info-strip" id="visit">
		<div class="glow glow-info" aria-hidden="true"></div>
		<div class="info-grid">
			<div class="info-col" data-reveal="rise">
				<h3>Visit</h3>
				<p>
					{brand.name}<br />{info.address.line1}<br />{info.address.city}<br />{info.address
						.postcode}
				</p>
				{#if info.address.metro}<p class="info-note">Nearest metro — {info.address.metro}</p>{/if}
			</div>
			<div class="info-col contact" data-reveal="rise" style="--rd: 0.06s">
				<h3>Contact</h3>
				<a class="contact-link" href="tel:{info.phone.replace(/\s/g, '')}">{info.phone}</a>
				<a class="contact-link" href="mailto:{info.email}">{info.email}</a>
			</div>
			<div class="info-col" data-reveal="rise" style="--rd: 0.12s">
				<h3>Opening Times</h3>
				{#each hoursSummary as h}
					<div class="hours-row"><span>{h.day}</span><span>{h.hours}</span></div>
				{/each}
				{#if info.hoursNote}<p class="info-note">{info.hoursNote}</p>{/if}
			</div>
		</div>
	</section>
</div>

<div data-brand="fusion">
	<SiteFooter {brand} />
</div>

<style>
	/* No `background` on :global(body) — a ground set from a route's :global(body)
	   outlives that route and leaks across brands. */
	:global(body) {
		margin: 0;
		color: var(--ink, #f2ece0);
		font-family: var(--font-body, 'Jost', system-ui, sans-serif);
	}

	/* ===== THE FUSION PALETTE =====
	   Declared once on .page and inherited by every band below, rather than
	   repeated per section the way Asia's page does it. Same token NAMES as Asia so
	   the two pages stay diffable side by side; only the values differ.
	   The --sakura slot is NO LONGER PINK on Fusion. Asia keeps sakura; this house
	   runs the SPRAY-PAINT TRIAD lifted straight out of the hero mural — the red
	   splashes, the cobalt hair and the yellow streak across the face. Sampled from
	   the artwork itself (fusion-hero-1600.webp): red #c71b13, blue #194c83, yellow
	   #cc8808, each raised in lightness here because the values as painted are too
	   dark to carry text or a button edge on a near-black ground.

	   The token keeps the name `--sakura` on purpose: it's the ACTION-COLOUR SLOT,
	   read by ~20 rules in this file and mirrored in BrandTopNav. Renaming it would
	   have touched every one for no visual gain. Read it as "the accent", not "pink". */
	.page {
		--ink: #0a0d0b;
		--panel: #0c1410;
		--panel-2: #101a15;
		--hair: rgba(221, 130, 54, 0.18);
		--gold: #dd8236;
		--gold-bright: #f79a4a;
		--ivory: #f2ece0;
		--muted: #9fb0a8;
		/* Red — the action colour. Buttons, outline edges, the "signature" menu rim. */
		--sakura: #d92e22;
		--sakura-2: #f0503f;
		--sakura-glow: rgba(217, 46, 34, 0.42);
		/* Blue — the cool counterweight, on the hero's emphasis word. */
		--paint-blue: #2f78d0;
		--paint-blue-2: #5ba3f0;
		/* Yellow — the small marks: the scroll pip and the section pips. */
		--paint-yellow: #e9b21f;
		--paint-yellow-2: #f7cd4a;
		/* Second accent. Muted teal — the cool note that keeps a page of warm golds
		   and near-black from reading as sepia. */
		--teal: #3f6f66;
		--teal-bright: #5a9184;
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);
		--ease-fusion: cubic-bezier(0.2, 0.8, 0.2, 1);
		/* The scrim ink, as component parts, so the many rgba(...) washes below can
		   be stated once each rather than repeating the triplet twenty times. */
		--scrim: 10, 13, 11;

		background: var(--page-bg);
		color: var(--ivory);
		font-family: var(--body-f);
		overflow-x: clip;
	}
	/* Only the first .page block owns the hero and needs to fill the viewport; the
	   second (reserve + info strip) would otherwise reserve a screenful of dead
	   ground under itself. */
	.page:first-of-type {
		/* svh, not vh: `100vh` on a phone is the LARGE viewport (address bar hidden),
		   so the foot of the hero — the CTA row and scroll cue — sits under the
		   browser chrome at rest. svh fits the worst case without dvh's re-layout on
		   every bar slide. vh first as the fallback. */
		min-height: 100vh;
		min-height: 100svh;
	}

	/* ===== THE AMBIENT LAYER: WARM GLOW + RING CLUSTER =====
	   The two motifs that carry the Fusion identity through the whole page, lifted
	   straight from the design template's `#view-fusion`: a broad gold radial wash
	   (the "orange hue") with a cooler teal one opposite it, and concentric rings
	   drawn in gold and teal hairlines.
	   They are NOT hero-only. The template repeats them across its hero, story,
	   specials and reserve blocks, and leaving them on one section made the rest of
	   the page read as plain dark green panels.
	   Both are decorative and inert: `pointer-events: none`, aria-hidden in the
	   markup, and always behind the content via z-index. */
	.glow {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background:
			radial-gradient(
				circle at var(--glow-x, 74%) var(--glow-y, 30%),
				rgba(221, 130, 54, 0.5),
				transparent 56%
			),
			radial-gradient(
				circle at var(--glow2-x, 18%) var(--glow2-y, 88%),
				rgba(90, 145, 132, 0.34),
				transparent 52%
			);
	}
	/* Over a PHOTOGRAPH the wash has to be screened, or it lands as a flat brown
	   film; on a solid panel it can sit as-is. */
	/* Screened at 0.85 this lifted the whole right half and the hero came out
	   noticeably lighter than the rest of the page; 0.5 keeps the warm cast without
	   washing the ground out. */
	.glow-hero {
		mix-blend-mode: screen;
		/* Trimmed with the scrim above. Screened over a picture that is no longer
		   held down at ~85%, the same wash reads as a brown film across the artwork
		   rather than as light behind the copy. */
		opacity: 0.16;
	}
	.rings {
		position: absolute;
		z-index: 1;
		pointer-events: none;
		opacity: 0.26;
	}
	.rings-hero {
		/* Concentric with the hero's warm centre, out on the right half. */
		top: 50%;
		right: -4%;
		translate: 0 -50%;
		width: min(760px, 58vw);
		height: min(760px, 58vw);
		/* Same gesture as the story cluster, on the hero's own clock (--hp, 0 while
		   the hero is parked → 1 once it has scrolled past): the rings open outward
		   as you leave the fold. They start at their laid-out size rather than
		   under it — this one is on screen at rest, so it has to look composed
		   before any scrolling happens; only the story cluster gets to arrive small.
		   `translate` is a separate property here, so scaling composes with the
		   -50% centring instead of overwriting it. The wash comes off as they
		   spread, so the growth doesn't crowd the headline it sits behind.
		   Fallbacks = the resting state, which is also the reduced-motion state. */
		opacity: calc(0.24 - var(--hp, 0) * 0.12);
		transform: scale(calc(1 + var(--hp, 0) * 0.34));
		transform-origin: 50% 50%;
		will-change: transform;
	}
	/* Story: the wash sits behind the COPY column (left) so the artwork bleeding off
	   the right isn't tinted, and the ring cluster hangs off the bottom-left corner
	   where the column has run out of text. */
	.glow-about {
		--glow-x: 8%;
		--glow-y: 16%;
		--glow2-x: 62%;
		--glow2-y: 96%;
		opacity: 0.13;
	}
	.rings-about {
		left: -13%;
		bottom: -34%;
		width: min(620px, 52vw);
		height: min(620px, 52vw);
		/* The one cluster that isn't static: it swells the whole way the section
		   crosses the viewport, driven by the same --p the picture's wipe comes from
		   (written straight onto this SVG by the handler, not onto .about, so the
		   rest of the section is not restyled every frame). Scaled about its own
		   centre so it reads as the rings WIDENING rather than the SVG sliding, and
		   the wash comes up with it so the growth doesn't just look like a zoom.
		   Fallbacks put it at roughly its old size/opacity — that's the reduced-motion
		   state, where the rAF handler never runs and --p is never set. */
		opacity: calc(0.1 + var(--p, 0.55) * 0.16);
		transform: scale(calc(0.62 + var(--p, 0.55) * 0.7));
		transform-origin: 50% 50%;
		will-change: transform;
	}
	/* Menu: warm top-right, cool bottom-left — the template's default arrangement. */
	.glow-menu {
		--glow-x: 88%;
		--glow-y: 6%;
		--glow2-x: 6%;
		--glow2-y: 92%;
		opacity: 0.11;
	}
	.rings-menu {
		right: -16%;
		top: -22%;
		width: min(560px, 46vw);
		height: min(560px, 46vw);
		opacity: 0.18;
	}
	/* Info strip closes the page, so it only gets the warm half, low. */
	.glow-info {
		--glow-x: 78%;
		--glow-y: 100%;
		--glow2-x: 10%;
		--glow2-y: 10%;
		opacity: 0.09;
	}
	/* Everything that isn't the ambient layer has to clear it. The sections set
	   their own stacking context, so this is scoped rather than global. */
	.about-grid,
	.menu-inner,
	.info-grid {
		position: relative;
		z-index: 2;
	}

	/* ===== SHARED EYEBROW =====
	   Spaced gold caps preceded by a short rule. currentColor on the rule lets the
	   slides tint it brighter without repeating the geometry. */
	.eyebrow,
	.hero-eyebrow {
		display: flex;
		align-items: center;
		gap: 14px;
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.6;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--gold);
		margin: 0;
	}
	.eyebrow::before,
	.hero-eyebrow::before {
		content: '';
		flex: none;
		width: 34px;
		height: 1px;
		background: currentColor;
	}
	/* The hero's eyebrow had no rule of its own and fell through as a plain 16px
	   sentence-case line — the one eyebrow on the page (and across both brands)
	   that wasn't spaced caps behind a rule. Brighter gold than the panel
	   eyebrows because this one sits on the artwork, as the slides' do. */
	.hero-eyebrow {
		color: var(--gold-bright);
	}

	/* ===== HERO =====
	   Drawn, not photographed — see the note on the markup. Copy sits on the LEFT
	   rail of a 1240px container, exactly as the template has it; the ring cluster
	   and the lit disc occupy the right, which is why the copy doesn't need a
	   photographic scrim to stay legible. */
	.hero {
		position: relative;
		/* border-box, or the padding is added on top of the 100vh and the hero
		   overshoots the viewport (which pushes the copy down and the scroll cue
		   off-screen). */
		box-sizing: border-box;
		/* See the note on `.page:first-of-type` — same reason. */
		min-height: 100vh;
		min-height: 100svh;
		display: flex;
		/* Copy sits in the RIGHT half, vertically centred. The artwork puts its face
		   in the left 45% and leaves the right side almost black, so this is the one
		   position where the headline needs no heavy scrim and the face is never
		   printed over. Bottom-left and centre-left were both tried and both landed
		   the type across her eyes and mouth. */
		align-items: center;
		justify-content: flex-end;
		overflow: hidden;
		padding: 140px 24px 110px;
		text-align: left;
		background: var(--ink);
	}

	.hero-bg {
		position: absolute;
		inset: 0;
		z-index: 0;
		overflow: hidden;
	}
	.hero-bg img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* Left-weighted: the copy now occupies the right half, so the crop protects
		   the FACE — a centred crop shaved ~124px off each side at 1440 and cut into
		   her hair. What gets trimmed instead is the far-right lantern, which the
		   headline sits over anyway. */
		object-position: 30% 45%;
		display: block;
	}
	/* A RIGHT→LEFT wash, deepening only across the half the copy sits in. The right
	   of this artwork is nearly black already, so it barely has to do anything —
	   which is the point: the earlier left-hand version needed ~90% opacity to
	   carry type over the face and buried the picture doing it. The face side is
	   left completely untouched.
	   The small top fade is only there to seat the nav, not to dim the image. */
	/* The blossom photograph is far brighter than the painting this wash was tuned
	   for (lit lanterns sit right under the headline), so a second right-hand wash
	   seats the copy. Wide screens only: on a phone the copy sits at the foot,
	   under the bottom wash. */
	.hero-bg::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background: linear-gradient(
			270deg,
			rgba(10, 13, 11, 0.86) 0%,
			rgba(10, 13, 11, 0.7) 30%,
			rgba(10, 13, 11, 0.25) 55%,
			transparent 72%
		);
	}
	@media (max-width: 760px) {
		.hero-bg::after {
			background: linear-gradient(0deg, rgba(10, 13, 11, 0.5) 0%, transparent 60%);
		}
	}
	.hero-bg::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		/* Four layers, in paint order:
		   1. VIGNETTE. In the template the warm glow sits on a near-black field
		      (var(--ink) behind two radial washes), and that dark surround is what
		      makes the gold read as light rather than as a flat brown film. A photo
		      fills that role here, so some of that darkness has to be put back — but
		      only at the very edges. The ellipse is deliberately WIDER than the frame
		      it darkens: a tight one puts its falloff straight across the face.
		   2. The right-to-left wash that seats the copy. It carries nearly all the
		      contrast work, because it is the only layer aimed at the half the type
		      actually sits in.
		   3. A faint flat wash, to tie 1 and 2 together.
		   4. A short top fade, to seat the nav.
		   THESE ALPHAS COMPOUND. Read individually they each look mild; multiplied
		   they are not. An earlier set (0.85 vignette corners, 0.24 flat) stacked to
		   roughly 85% coverage over the face and ~87% over the right half, which is
		   what buried the artwork — the picture was there and simply could not be
		   seen. The numbers below land the face near 50% and the copy side near 80%,
		   so the headline keeps its contrast and the painting is legible again.
		   Before touching any value here, work out the COMBINED alpha at the face
		   (~25% across) as 1 - Π(1 - layer), not each layer on its own.
		   NOTE: keep these comments OUT of the declaration value. Svelte's CSS parser
		   reads an apostrophe inside a value comment as the start of a string and
		   fails the whole stylesheet with "Expected a valid CSS identifier" — which
		   500s the route, not just the rule. */
		background:
			radial-gradient(
				ellipse 104% 92% at 64% 44%,
				rgba(var(--scrim), 0.1) 22%,
				rgba(var(--scrim), 0.3) 62%,
				rgba(var(--scrim), 0.58) 100%
			),
			linear-gradient(
				270deg,
				rgba(var(--scrim), 0.88) 0%,
				rgba(var(--scrim), 0.76) 26%,
				rgba(var(--scrim), 0.42) 46%,
				rgba(var(--scrim), 0.14) 64%,
				rgba(var(--scrim), 0.04) 100%
			),
			linear-gradient(rgba(var(--scrim), 0.1), rgba(var(--scrim), 0.1)),
			linear-gradient(180deg, rgba(var(--scrim), 0.62) 0%, transparent 16%);
	}
	/* The template's index mark, bottom-left. */
	.hero-dots {
		position: absolute;
		left: clamp(20px, 4vw, 54px);
		bottom: 42px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 14px;
		font-family: var(--body-f);
		font-size: 0.66rem;
		letter-spacing: 0.26em;
		color: var(--muted);
	}
	.hero-dots .line {
		width: 54px;
		height: 1px;
		background: var(--hair);
	}

	.hero-inner {
		position: relative;
		z-index: 2;
		width: 100%;
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 32px;
		box-sizing: border-box;
		display: flex;
		justify-content: flex-end;
	}
	.hero-copy {
		max-width: 600px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
	}
	.hero-title {
		font-family: var(--display);
		font-weight: 600;
		/* Baskerville sets wider than Asia's Shippori Mincho at the same size, and
		   "every corner" is a long accent line — so the ceiling is a step lower to
		   stop it wrapping to three lines on a laptop. */
		font-size: clamp(2.3rem, 5.2vw, 3.9rem);
		line-height: 1.06;
		letter-spacing: 0.005em;
		color: var(--ivory);
		margin: 20px 0 24px;
	}
	/* :global — the <em> is rendered inside the RichText child component, so the
	   scoped selector wouldn't reach it. It isn't italicised here, so the emphasis
	   reads as colour alone — which is why the colour has to carry.
	   BLUE, not the action red: the words sit directly over the mural's cobalt hair,
	   and a red emphasis next to a red button read as one more button. */
	.hero-title :global(em) {
		font-style: normal;
		font-weight: inherit;
		color: var(--paint-blue-2);
	}
	.hero-line {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1.02rem;
		line-height: 1.62;
		color: var(--muted);
		max-width: 460px;
		margin: 0 0 38px;
	}
	.hero-actions {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		justify-content: flex-start;
	}

	/* ===== BUTTONS =====
	   The hover is one idea in two registers: a soft lift, a single specular sheen
	   crossing the face, and (outline only) sakura ink rising from the bottom edge
	   with a curved meniscus that flattens as it fills. .btn-solid is already
	   filled, so instead of the fill its gradient drifts across while the shadow
	   blooms underneath it. ::before is the ink, ::after the sheen — both sit under
	   the label via z-index -1 inside the button's own stacking context. */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--sakura);
		color: var(--ivory);
		background: transparent;
		padding: 15px 30px;
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.6;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		text-decoration: none;
		position: relative;
		overflow: hidden;
		z-index: 0;
		transition:
			color 0.45s var(--ease),
			border-color 0.45s var(--ease),
			transform 0.55s var(--ease),
			box-shadow 0.55s var(--ease);
	}
	/* The rising ink. Wider than the button and curved along its top edge so the
	   leading edge reads as liquid; the curve relaxes to flat as it lands. */
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
			transform 0.6s var(--ease),
			border-radius 0.6s var(--ease);
		z-index: -1;
	}
	/* The sheen — a narrow skewed highlight, fired once per hover rather than
	   parked at rest, so it registers as a glint and not a moving part. */
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
		animation: btn-sheen 0.9s var(--ease) 0.15s;
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

	/* Solid: no ink to raise — the gradient itself drifts across on hover. */
	.btn-solid {
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2) 52%, var(--sakura));
		background-size: 220% 100%;
		background-position: 0% 50%;
		color: #fff;
		border-color: transparent;
		box-shadow: 0 10px 26px -10px var(--sakura-glow);
		transition:
			transform 0.55s var(--ease),
			box-shadow 0.55s var(--ease),
			background-position 0.75s var(--ease);
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

	/* Scroll cue — centred, with a sakura pip falling down a hairline.
	   Centring uses `translate:` (not `transform:`) so the entry animation below
	   can own `transform` without fighting it. */
	.scroll-cue {
		position: absolute;
		bottom: 30px;
		left: 50%;
		translate: -50% 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		font-family: var(--body-f);
		font-size: 0.65rem;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.scroll-cue .stick {
		width: 1px;
		height: 36px;
		background: var(--hair);
		position: relative;
		overflow: hidden;
	}
	.scroll-cue .stick::after {
		content: '';
		position: absolute;
		top: -40%;
		left: 0;
		width: 100%;
		height: 40%;
		/* Yellow — the third paint colour, kept for the small marks so the triad is
		   all present without the page turning into three competing buttons. */
		background: var(--paint-yellow);
		animation: dropdown 2.2s ease-in-out infinite;
	}
	@keyframes dropdown {
		0% {
			top: -40%;
		}
		60%,
		100% {
			top: 100%;
		}
	}

	/* ===== HERO ENTRY CHOREOGRAPHY =====
	   Every delay below is `--t0 + n`, where --t0 is when the hero is first VISIBLE.
	   That single variable is what makes one choreography serve both arrivals:

	     direct visit    the hero's own curtain lifts, so --t0 waits for it (0.34s)
	     from the front  the layout's shoji panels are the curtain and are already
	     door            parting, so --t0 is 0 and the copy rises THROUGH the open —
	                     concurrent, not sequential */
	.hero {
		--t0: 0.26s;
	}
	.hero.from-landing {
		--t0: 0s;
	}

	.hero-curtain {
		position: absolute;
		inset: 0;
		z-index: 5;
		/* Flat --ink. Any difference from the page ground, the shoji and the page dip
		   shows as a visible colour pop at the moment the wipe finishes. */
		background: #0a0d0b;
		transform-origin: top;
		transition: transform 0.62s cubic-bezier(0.5, 0.05, 0.25, 1);
		pointer-events: none;
	}
	.hero.enter .hero-curtain {
		transform: scaleY(0);
	}

	/* The artwork settles out of a slight push-in as it's revealed, so the arrival
	   has depth instead of being a static backdrop appearing behind moving panels. */
	.hero-bg img {
		transform: scale(1.03);
		transition: transform 1.2s cubic-bezier(0.22, 0.9, 0.3, 1);
	}
	.hero.enter .hero-bg img {
		transform: scale(1);
	}
	/* Title lines clip-rise from their own overflow mask */
	.ht-line {
		display: block;
		overflow: hidden;
		/* Pad the clip box so descenders aren't sheared off by overflow: hidden;
		   pull it back with a matching negative margin so layout is unchanged. */
		padding-bottom: 0.16em;
		margin-bottom: -0.16em;
	}
	.ht-in {
		display: inline-block;
		transform: translateY(112%);
		transition: transform 0.64s var(--ease-fusion);
	}
	.hero.enter .ht-in {
		transform: translateY(0);
	}
	.ht-line:nth-child(1) .ht-in {
		transition-delay: calc(var(--t0) + 0.16s);
	}
	.ht-line:nth-child(2) .ht-in {
		transition-delay: calc(var(--t0) + 0.24s);
	}

	/* Eyebrow / lede / actions / index mark / scroll cue: fade + small rise */
	.hero-eyebrow,
	.hero-line,
	.hero-actions,
	.hero-dots,
	.scroll-cue {
		opacity: 0;
		transform: translateY(9px);
		transition:
			opacity 0.55s var(--ease-fusion),
			transform 0.55s var(--ease-fusion);
	}
	.hero.enter .hero-eyebrow,
	.hero.enter .hero-line,
	.hero.enter .hero-actions,
	.hero.enter .hero-dots,
	.hero.enter .scroll-cue {
		opacity: 1;
		transform: translateY(0);
	}
	.hero.enter .hero-dots {
		transition-delay: calc(var(--t0) + 0.3s);
	}
	.hero.enter .hero-eyebrow {
		transition-delay: calc(var(--t0) + 0.06s);
	}
	.hero.enter .hero-line {
		transition-delay: calc(var(--t0) + 0.2s);
	}
	.hero.enter .hero-actions {
		transition-delay: calc(var(--t0) + 0.26s);
	}
	.hero.enter .scroll-cue {
		transition-delay: calc(var(--t0) + 0.34s);
	}

	@media (max-width: 600px) {
		.hero {
			padding: 120px 20px 90px;
		}
		.hero-inner {
			padding: 0;
		}
		/* "Global Flavours · Family Table" is six characters longer than Asia's
		   eyebrow and wrapped to two lines at 360px on the full tracking. A shorter
		   rule and slightly closer caps keep it on one. */
		.hero-eyebrow {
			gap: 12px;
			letter-spacing: 0.26em;
		}
		.hero-eyebrow::before {
			width: 26px;
		}
		.hero-actions {
			gap: 12px;
		}
		.btn {
			padding: 14px 22px;
			letter-spacing: 0.18em;
		}
		.scroll-cue,
		.hero-dots {
			display: none;
		}
		/* A phone has no "right half" to move the copy into — the column is the full
		   width — so the desktop side-by-side arrangement is dropped and the copy
		   goes back to the FOOT of the frame, under a bottom-up wash. That keeps the
		   face clear in the upper two-thirds, which is the same goal by other means. */
		/* FIRST VISIT: the cookie notice is fixed to the bottom of the screen and,
		   on a phone, lands exactly on the two buttons. CookieBanner publishes its
		   height on the root element as `--cb-h` (unset once dismissed), so the stack is
		   lifted by just what the notice takes beyond the 90px foot that was
		   already clear — `--cb-lift`, which leaves the buttons 20px above it and
		   is 0 with no notice. Not the whole banner height: that put the headline
		   across her eyes. The padding eases so the copy settles back down when
		   Reject/Accept is tapped instead of dropping. */
		.hero {
			--cb-lift: max(0px, calc(var(--cb-h, 0px) - 70px));
			/* See the note on `.hero-bg img` below. */
			--face-lift: max(0px, calc(415px - 54.5svh));
			align-items: flex-end;
			padding-bottom: calc(90px + var(--cb-lift));
			transition: padding-bottom 0.35s var(--ease);
		}
		/* Every stop carries the same lift, so the ink climbs with the copy and the
		   headline is never left standing on the bare face while the notice is up. */
		.hero-bg::before {
			background: linear-gradient(
				0deg,
				rgba(var(--scrim), 0.96) var(--cb-lift),
				rgba(var(--scrim), 0.88) calc(30% + var(--cb-lift)),
				rgba(var(--scrim), 0.5) calc(52% + var(--cb-lift)),
				rgba(var(--scrim), 0.12) calc(74% + var(--cb-lift)),
				transparent calc(88% + var(--cb-lift))
			);
		}
		/* A portrait frame crops this landscape artwork hard from the sides, so the
		   crop is pulled well left to keep the FACE in shot — at 38% all that
		   survived at the left edge was one eye. */
		/* ...and the PAINTING RIDES UP WITH THE COPY. The artwork is scaled to the
		   frame's height, so her eye sits at a fixed ~39–46% down it while the copy
		   stack is a fixed ~305px off the foot: lifting the stack alone (the notice)
		   or shortening the frame (Safari's toolbars showing, ~664px) walks the type
		   straight onto the eye — seen on the real notice as "Flavours from" across
		   it at 360x780 and "every corner" across it at 390x664, and with no notice
		   at all the eyebrow ran through it at 390x664. So the picture is shifted by
		   the same --cb-lift, plus --face-lift: what a frame shorter than ~760px
		   needs to keep the eye above the eyebrow (0 on a full-height phone). The
		   strip this uncovers at the foot is under the 96% ink of the wash above
		   (and under the notice while it is up), so nothing shows. `translate`, not
		   `transform` — the entry push-in owns that — and on the padding's clock, so
		   the face and the copy settle together when the notice goes. */
		.hero-bg img {
			object-position: 30% 40%;
			translate: 0 calc((var(--cb-lift) + var(--face-lift)) * -1);
			transition:
				transform 1.2s cubic-bezier(0.22, 0.9, 0.3, 1),
				translate 0.35s var(--ease);
		}
	}

	/* ===== OUR STORY ===== */
	.about {
		position: relative;
		background: var(--panel);
		/* Ground below the picture: its paint drips must run out over the panel, not
		   into the mural band that follows. */
		padding: 84px 0 64px;
		overflow: hidden;
	}
	/* Asymmetric, and NOT a centred container: the left column is padded in to the
	   1240px container's left edge, while the right column runs unbounded to the
	   viewport's right edge so the artwork bleeds off the page. `max()` keeps the
	   copy aligned with every other section on a wide screen and falls back to a
	   plain 32px gutter once the viewport is narrower than the container. */
	/* Copy left, the New Menu film right — the film as large as the screen
	   allows, in a 9:16 frame with nothing competing with it. */
	.about-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: clamp(40px, 7vw, 120px);
		align-items: center;
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 32px;
		box-sizing: border-box;
	}
	.about-copy {
		max-width: 560px;
	}
	.about-media {
		position: relative;
		height: clamp(560px, 86vh, 860px);
		aspect-ratio: 9 / 16;
	}
	.dish-frame,
	.dish-outline {
		position: absolute;
		inset: 0;
		border-radius: 24px;
	}
	/* Offset hairline frame, drawn in once the section arrives. */
	.dish-outline {
		transform: translate(-20px, -20px);
		border: 1px solid rgba(221, 130, 54, 0.5);
		pointer-events: none;
	}
	/* The film. --o (0→1, written by the scroll handler in onMount) unveils it
	   from the bottom and settles it out of a push-in. Fallback 1 = fully open. */
	.dish-frame {
		overflow: hidden;
		background: #050706;
		box-shadow:
			0 60px 120px -40px rgba(0, 0, 0, 0.9),
			0 0 0 1px rgba(221, 130, 54, 0.25);
		clip-path: inset(calc((1 - var(--o, 1)) * 100%) 0 0 0 round 24px);
		will-change: clip-path;
	}
	.dish-frame video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transform: scale(calc(1.2 - var(--o, 1) * 0.2));
	}


	/* A short gold rule and small caps, in place of Asia's solid plaque. */
	.about-tag {
		margin: 30px 0 0 !important;
		padding-top: 22px;
		border-top: 1px solid var(--hair);
		font-family: var(--body-f);
		font-size: 0.72rem !important;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--gold) !important;
	}
	.about-copy h2 {
		font-family: var(--display);
		font-weight: 600;
		font-size: clamp(1.8rem, 3.4vw, 2.6rem);
		line-height: 1.14;
		letter-spacing: 0.005em;
		color: var(--ivory);
		margin: 22px 0 26px;
	}
	.about-copy p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1rem;
		line-height: 1.66;
		color: var(--muted);
		margin: 0 0 20px;
	}
	/* The lead paragraph reads a step brighter and larger than the two under it. */
	.about-copy p:first-of-type {
		color: var(--ivory);
		font-size: 1.12rem;
	}

	/* ===== SPECIALS =====
	   A framed 16:9 banner inside the page container — the shape of the design
	   pack's poster artwork (1600x854 / 1600x900), so posters fill it exactly.
	   Nothing is cropped or stretched: posters are contained, and a photo slide
	   shows its (portrait) photo whole in a panel on the right beside the copy.
	   The frame stays fixed across slides so the page never jumps on autoplay. */
	.specials {
		position: relative;
		background: var(--panel);
		padding: clamp(56px, 8vw, 110px) 32px;
	}
	.specials-slider {
		position: relative;
		width: 100%;
		max-width: 1240px;
		margin: 0 auto;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: 22px;
		background: var(--ink);
		box-shadow:
			0 60px 120px -50px rgba(0, 0, 0, 0.9),
			0 0 0 1px rgba(221, 130, 54, 0.2);
	}
	/* SLIDE CHANGE — the incoming slide wipes across the outgoing one from the
	   right (a curtain, not a fade), its artwork settling out of a push-in, while
	   the slide underneath sinks back and dims. The picture always comes to rest
	   whole, at scale 1. */
	.special-slide {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		visibility: hidden;
		z-index: 0;
		clip-path: inset(0 0 0 100%);
	}
	.special-slide.prev {
		visibility: visible;
		z-index: 1;
		clip-path: inset(0);
	}
	.special-slide.prev .slide-bg {
		transform: scale(0.92);
		filter: brightness(0.45);
		transition:
			transform 1.3s cubic-bezier(0.77, 0, 0.18, 1),
			filter 1.3s ease;
	}
	.special-slide.active {
		visibility: visible;
		z-index: 2;
		clip-path: inset(0);
		transition: clip-path 1.25s cubic-bezier(0.77, 0, 0.18, 1);
	}
	.special-slide.active .slide-bg .sharp {
		animation: spec-settle 1.9s cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	@keyframes spec-settle {
		from {
			scale: 1.18;
		}
		to {
			scale: 1;
		}
	}
	/* the button (and a photo slide's copy) rises in once the wipe has passed */
	.special-slide.active .special-copy-inner > :global(*) {
		animation: spec-rise 0.9s cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: 0.75s;
	}
	.special-slide.active .special-copy-inner > :global(*:nth-child(2)) {
		animation-delay: 0.85s;
	}
	.special-slide.active .special-copy-inner > :global(*:nth-child(3)) {
		animation-delay: 0.95s;
	}
	.special-slide.active .special-copy-inner > :global(*:nth-child(4)) {
		animation-delay: 1.05s;
	}
	@keyframes spec-rise {
		from {
			opacity: 0;
			transform: translateY(26px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	/* slide counter, top-right */
	.specials-count {
		position: absolute;
		z-index: 3;
		top: 26px;
		right: 32px;
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-family: var(--display);
		color: var(--ivory);
		text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6);
		overflow: hidden;
	}
	.specials-count .now {
		display: inline-block;
		font-size: 1.6rem;
		animation: spec-count 0.8s cubic-bezier(0.16, 1, 0.3, 1) both;
	}
	.specials-count .of {
		font-family: var(--body-f);
		font-size: 0.72rem;
		letter-spacing: 0.2em;
		color: rgba(242, 236, 224, 0.7);
	}
	@keyframes spec-count {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	.special-slide .slide-bg {
		position: absolute;
		inset: 0;
		z-index: 0;
		background: var(--ink);
	}
	.special-slide .slide-bg img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.special-slide .slide-bg .sharp {
		object-fit: contain;
		object-position: center;
	}
	.special-slide .slide-bg .poster-fill {
		object-fit: cover;
		transform: scale(1.15);
		filter: blur(44px) saturate(1.1) brightness(0.4);
	}
	/* Photo slides: the photo whole, at its own shape, in a panel on the right. */
	.special-slide:not(.poster) .slide-bg .sharp {
		left: auto;
		right: 0;
		width: auto;
		max-width: 52%;
		aspect-ratio: 3 / 4;
		-webkit-mask-image: linear-gradient(to right, transparent, #000 14%);
		mask-image: linear-gradient(to right, transparent, #000 14%);
	}
	.special-slide.poster::before {
		background: linear-gradient(0deg, rgba(var(--scrim), 0.55) 0%, transparent 22%);
	}
	/* The design pack's artwork is dark and high-contrast already, and anything
	   heavier just muddies it. */
	.special-slide::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background: linear-gradient(
			90deg,
			rgba(var(--scrim), 0.9) 0%,
			rgba(var(--scrim), 0.6) 45%,
			transparent 62%
		);
	}
	.special-copy {
		position: relative;
		z-index: 2;
		width: 100%;
		padding: 0 0 96px;
	}
	.special-copy-inner {
		max-width: 52%;
		padding: 0 48px;
		box-sizing: border-box;
	}
	.special-copy .eyebrow {
		color: var(--gold-bright);
	}
	.special-copy h3 {
		font-family: var(--display);
		font-weight: 600;
		font-size: clamp(1.7rem, 3.6vw, 2.8rem);
		line-height: 1.12;
		color: var(--ivory);
		margin: 16px 0 14px;
	}
	.special-copy p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1rem;
		line-height: 1.62;
		color: var(--muted);
		max-width: 480px;
		margin: 0 0 26px;
	}
	.specials-tabs {
		position: absolute;
		z-index: 3;
		left: 40px;
		bottom: 36px;
		display: flex;
		gap: 10px;
	}
	.specials-tabs button {
		width: 34px;
		height: 3px;
		padding: 0;
		border: none;
		background: rgba(242, 236, 224, 0.22);
		cursor: pointer;
		transition: background 0.3s;
	}
	/* each tab is a 7s progress bar for its slide */
	.specials-tabs button {
		position: relative;
		overflow: hidden;
	}
	.specials-tabs button::after {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		width: 100%;
		height: 3px;
		margin-top: -1.5px;
		background: var(--gold);
		transform-origin: left;
		transform: scaleX(0);
	}
	.specials-tabs button.active::after {
		animation: spec-progress 7s linear forwards;
	}
	.specials-slider.paused .specials-tabs button.active::after {
		animation-play-state: paused;
	}
	@keyframes spec-progress {
		to {
			transform: scaleX(1);
		}
	}
	.specials-nav {
		position: absolute;
		z-index: 3;
		right: 40px;
		bottom: 36px;
		display: flex;
		gap: 12px;
	}
	.specials-nav button {
		width: 46px;
		height: 46px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--hair);
		background: rgba(var(--scrim), 0.5);
		color: var(--ivory);
		cursor: pointer;
		transition: 0.3s;
	}
	.specials-nav button svg {
		width: 16px;
		height: 16px;
	}
	.specials-nav button:hover {
		background: var(--gold);
		color: var(--ink);
		border-color: var(--gold);
	}

	/* ===== THE PRINTED MENU =====
	   Was a grid of six numbered photo tiles (the design template's treatment, and
	   before that a full-width ivory band that read as a different website). It's
	   now the printed sheet itself, framed the way Asia frames its spreads — the
	   owner asked for the two home pages to present the menu the same way. */
	.menu {
		position: relative;
		/* Clips the ring cluster, which deliberately overhangs the corner. */
		overflow: hidden;
		background: var(--panel-2);
		padding: clamp(70px, 8vw, 110px) 0;
	}
	.menu-inner {
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 32px;
		box-sizing: border-box;
	}
	/* The head runs the full column width: title left, lead right on its baseline.
	   Stacked in one narrow column it left a screen-wide hole to its right. */
	.section-head {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		column-gap: clamp(32px, 5vw, 72px);
		align-items: end;
		margin-bottom: clamp(32px, 4vw, 48px);
	}
	.section-head .eyebrow {
		grid-column: 1 / -1;
		margin-bottom: 20px;
	}
	.section-head h2 {
		font-family: var(--display);
		font-weight: 600;
		font-size: clamp(1.8rem, 3.4vw, 2.7rem);
		line-height: 1.14;
		letter-spacing: 0.005em;
		color: var(--ivory);
		margin: 0;
		max-width: 16ch;
	}
	.section-head .lead {
		margin: 0 0 6px;
		max-width: 46ch;
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1rem;
		line-height: 1.62;
		color: var(--muted);
	}
	.section-head .lead a {
		color: var(--ivory);
		text-decoration: none;
		border-bottom: 1px solid var(--gold);
		padding-bottom: 1px;
		transition: color 0.3s var(--ease);
	}
	.section-head .lead a:hover,
	.section-head .lead a:focus-visible {
		color: var(--gold-bright);
	}

	/* The printed sheet. An ember hairline and an ink mat frame it like a menu on a
	   table; it lifts a little on hover, the way the buttons do. Same rules Asia
	   runs (Svelte styles don't cross files, so they're restated rather than
	   shared) — only the rim colour is Fusion's, since --sakura is overridden to
	   the mural red in this file's token block.
	   Landscape A3 sheets, so the column is capped at 1100px and the section's own
	   1240px max-width does the rest. */
	.menu-spreads {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 34px;
	}
	.spread {
		display: block;
		width: 100%;
		max-width: 1100px;
		border: 1px solid var(--hair);
		background: var(--panel);
		padding: 10px;
		box-sizing: border-box;
		box-shadow: 0 24px 60px -30px rgba(0, 0, 0, 0.9);
		text-decoration: none;
		translate: 0 0;
		transition:
			border-color 0.45s var(--ease),
			translate 0.5s var(--ease),
			box-shadow 0.5s var(--ease);
	}
	.spread img {
		display: block;
		width: 100%;
		height: auto;
	}
	.spread:hover,
	.spread:focus-visible {
		border-color: var(--sakura);
		translate: 0 -4px;
		box-shadow: 0 30px 70px -28px var(--sakura-glow);
	}

	.menu-links-extra {
		margin-top: 56px;
		justify-content: center;
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
	}
	.menu-links-extra a {
		border: 1px solid var(--hair);
		padding: 14px 22px;
		font-family: var(--body-f);
		font-size: 0.7rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--muted);
		transition: 0.3s;
	}
	.menu-links-extra a:hover,
	.menu-links-extra a:focus-visible {
		border-color: var(--gold);
		color: var(--gold-bright);
	}
	/* The whole menu is the one people actually want — give it the sakura rim. */
	.menu-links-extra .pdf-primary {
		border-color: var(--sakura);
		color: var(--ivory);
	}
	.menu-links-extra .pdf-primary:hover,
	.menu-links-extra .pdf-primary:focus-visible {
		border-color: var(--sakura-2);
		color: #fff;
		box-shadow: 0 12px 30px -14px var(--sakura-glow);
	}
	/* Same ragged-staircase fix as Asia — see the note on its copy of this rule —
	   and the same squared grid: the full menu across the top, the rest in two
	   equal columns. One full-width column was ten stacked bars here, 570px of
	   identical rectangles to thumb past before the Reserve band; this is 410.
	   EQUAL ROWS: half the labels need two lines in a 155px cell ("Christmas Day
	   Menu (PDF)") and half do not, so content-sized rows came out 60 / 48 / 48 /
	   60 — a visibly uneven ladder. `1fr` rows all take the tallest, and the
	   balanced wrap stops "(PDF)" being left on a line of its own. */
	@media (max-width: 760px) {
		.menu-links-extra {
			margin-top: 40px;
			display: grid;
			grid-template-columns: 1fr 1fr;
			grid-auto-rows: 1fr;
			gap: 10px;
		}
		.menu-links-extra a {
			display: flex;
			align-items: center;
			justify-content: center;
			box-sizing: border-box;
			min-height: 48px;
			padding: 13px 10px;
			text-align: center;
			text-wrap: balance;
			line-height: 1.45;
			letter-spacing: 0.1em;
		}
		.menu-links-extra .pdf-primary {
			grid-column: 1 / -1;
			letter-spacing: 0.14em;
		}
		/* An odd one left over takes the whole last row rather than half of it. */
		.menu-links-extra .pdf-primary ~ a:last-child:nth-child(even),
		.menu-links-extra a:first-child:not(.pdf-primary) ~ a:last-child:nth-child(odd) {
			grid-column: 1 / -1;
		}
	}

	/* ===== RESERVE ===== */
	.reserve {
		position: relative;
		padding: 150px 24px;
		text-align: center;
		overflow: hidden;
		background: var(--panel);
	}
	.reserve-bg {
		position: absolute;
		inset: 0;
	}
	.reserve-bg img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		filter: brightness(0.58) saturate(1);
	}
	/* Softer than Asia's (which runs to solid --ink top and bottom): this artwork is
	   the brightest of the six and the point of using it is that it lifts the foot
	   of the page rather than fading to black. */
	.reserve-bg::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, var(--panel), rgba(var(--scrim), 0.42) 42%, var(--panel));
	}
	.reserve-inner {
		position: relative;
		z-index: 2;
		max-width: 1240px;
		margin: 0 auto;
	}
	.reserve .eyebrow {
		justify-content: center;
	}
	.reserve h2 {
		font-family: var(--display);
		font-weight: 600;
		font-size: clamp(1.9rem, 4vw, 3rem);
		line-height: 1.16;
		color: var(--ivory);
		margin: 20px auto 18px;
		max-width: 700px;
	}
	.reserve p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1rem;
		line-height: 1.62;
		color: var(--muted);
		max-width: 480px;
		margin: 0 auto 36px;
	}
	/* `.reserve` prefix on purpose: bare `.reserve-note` loses to `.reserve p`
	   above, which handed the note the body size and a 36px bottom margin. */
	.reserve .reserve-note {
		margin: 26px auto 0;
		font-size: 0.86rem;
	}
	.reserve-note em {
		font-style: italic;
	}

	/* ===== INFO STRIP =====
	   The lightest of the three green tiers, so the page finishes a shade up rather
	   than sinking back into the hero's near-black. */
	.info-strip {
		position: relative;
		overflow: hidden;
		background: var(--panel-2);
		padding: 110px 0;
	}
	.info-grid {
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 32px;
		box-sizing: border-box;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 60px;
	}
	.info-col h3 {
		font-family: var(--display);
		font-weight: 600;
		font-size: 1.05rem;
		letter-spacing: 0.02em;
		color: var(--gold-bright);
		margin: 0 0 22px;
	}
	.info-col p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 0.94rem;
		line-height: 1.72;
		color: var(--muted);
		margin: 0 0 10px;
	}
	.info-col .info-note {
		margin-top: 14px;
		font-size: 0.82rem;
	}
	.info-col .contact-link {
		display: block;
		margin-bottom: 6px;
		font-family: var(--body-f);
		font-size: 1rem;
		text-decoration: none;
		color: var(--ivory);
		transition: 0.3s;
	}
	.info-col .contact-link:hover,
	.info-col .contact-link:focus-visible {
		color: var(--gold-bright);
	}
	.hours-row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 9px 0;
		border-bottom: 1px dashed var(--hair);
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.hours-row span:last-child {
		color: var(--ivory);
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 1080px) {
		/* Stacked: copy first, then the film frame centred under it. */
		.about-grid {
			grid-template-columns: 1fr;
			gap: 56px;
		}
		.about-media {
			justify-self: center;
			height: min(80vh, 760px);
		}
		.info-grid {
			grid-template-columns: 1fr;
			gap: 34px;
		}
	}
	@media (max-width: 900px) {
		/* Side by side stops working once the title has to wrap hard — stack. */
		.section-head {
			grid-template-columns: 1fr;
			row-gap: 18px;
		}
		.section-head h2 {
			max-width: 14ch;
		}
	}
	@media (max-width: 760px) {
		/* Stacked, the picture used to run full-bleed off BOTH edges and sit flush
		   on the room band below it — two face murals butted together with no
		   seam, reading as one confused image. It now holds the copy's left edge
		   and bleeds off the right only (the desktop gesture, kept), with a strip
		   of panel under it so the band starts as its own thing. */
		.about {
			padding: 70px 0 40px;
		}
		.about-grid {
			padding: 0 20px;
		}
		/* No scroll-driven unveil on a phone (the handler doesn't write --o there —
		   stacked, the frame is far down the section and the wipe would be over
		   before it showed). The data-reveal="film" arrival is what a phone sees. */
		.dish-frame {
			will-change: auto;
		}
		.about-media {
			height: auto;
			width: min(calc(100% - 24px), 360px);
		}
		.dish-outline {
			transform: translate(-12px, -12px);
		}
		/* Two even lines instead of one long one with "MEET" orphaned under it —
		   and the same for the headline, which broke as "One kitchen, every /
		   craving" at 360–390. The paragraphs take `pretty` instead: it only
		   rescues a one-word last line ("twists." at 430) and leaves the rest of
		   the rag alone. (The tag is itself a <p> in .about-copy, hence the
		   order and the two-class selector.) */
		.about-copy p {
			text-wrap: pretty;
		}
		.about-copy .about-tag,
		.about-copy h2 {
			text-wrap: balance;
		}
		/* Phone: the picture on top at its true 16:9 (a poster fills it exactly,
		   a photo sits whole in the middle of its own blurred copy), and the copy,
		   button and controls on the panel underneath — never printed over it. */
		.specials {
			padding: 56px 14px;
		}
		.specials-slider {
			aspect-ratio: auto;
			height: calc((100vw - 28px) * 9 / 16 + 230px);
			border-radius: 16px;
		}
		.special-slide .slide-bg {
			bottom: auto;
			height: calc((100vw - 28px) * 9 / 16);
		}
		.special-slide:not(.poster) .slide-bg .sharp {
			left: 0;
			right: 0;
			width: 100%;
			max-width: none;
			aspect-ratio: auto;
			-webkit-mask-image: none;
			mask-image: none;
		}
		.special-slide::before,
		.special-slide.poster::before {
			display: none;
		}
		.special-copy {
			padding: 0 0 78px;
		}
		.special-copy-inner {
			max-width: none;
			padding: 0 20px;
		}
		.special-copy h3 {
			margin: 10px 0 14px;
			font-size: 1.5rem;
		}
		.special-copy p {
			display: none;
		}
		/* Offer timings run long ("Mon–Thu all day / Fri & Sat 12–5:30pm") and at
		   0.32em tracking broke after "12–", leaving the time on a line of its own
		   with the rule floating between the two. Asia's fix, same numbers: closer
		   caps, a shorter rule held to the first line, and a balanced wrap. */
		.special-copy .eyebrow {
			align-items: flex-start;
			gap: 10px;
			letter-spacing: 0.2em;
			text-wrap: balance;
		}
		.special-copy .eyebrow::before {
			width: 20px;
			margin-top: 0.8em;
		}
		/* "…with three dishes / each." — a blurb is one or two lines, so even them. */
		.special-copy p {
			text-wrap: balance;
		}
		.special-copy-inner {
			padding: 0 20px;
		}
		/* The tabs are 3px hairlines — fine to look at, impossible to hit. The
		   padding is the tap area (31px tall) and `background-clip` keeps the
		   painted bar at 3px. `.active` MUST be restated: its `background`
		   shorthand resets the clip, and without this the current tab paints as a
		   solid 34x31 gold block. */
		.specials-tabs {
			left: 20px;
			bottom: 26px;
			gap: 8px;
		}
		.specials-tabs button {
			box-sizing: content-box;
			padding: 14px 0;
			background-clip: content-box;
		}
		.specials-tabs button.active {
			background-clip: content-box;
		}
		.specials-nav {
			right: 20px;
			bottom: 19px;
			gap: 8px;
		}
		.specials-nav button {
			width: 44px;
			height: 44px;
		}
		.menu {
			padding: 70px 0;
		}
		.menu-inner,
		.info-grid {
			padding: 0 20px;
		}
		/* A dense A3 landscape sheet is unreadable at phone width whatever we do —
		   the mat and its padding just eat pixels, so drop them and let the sheet
		   run edge to edge. Tapping it opens the PDF, which zooms properly. */
		.menu-spreads {
			gap: 22px;
		}
		.spread {
			padding: 4px;
		}
		.reserve {
			padding: 100px 20px;
		}
		/* Keeps the dash off the head of a line where it can, and evens the rag. */
		.reserve p {
			text-wrap: balance;
		}
		/* Phone and email are the two things here people tap — give each a
		   finger's height instead of a 23px line 6px from its neighbour: 11px a
		   side makes a 44px row (8px was 38, still short of a thumb). Same size
		   as Asia's, so the pair sits on one line at 390 here too. */
		.info-col .contact-link {
			padding: 11px 0;
			margin: 0;
			font-size: 0.95rem;
		}
		/* A COMPACT strip — the same rules, to the pixel, as Asia's. The footer
		   straight under this repeats all three blocks (address, contact, every
		   day's hours), so on a phone the strip was 712px — most of a screen — of
		   scrolling past what the next screen says again. Same words, same order,
		   set tighter: 490px at 390. The number and the email share a line (this
		   address needs 362px of screen; at 360 they wrap back to two rows), and their own
		   11px of padding stands in for the gap under "Contact", taken back off
		   the column's foot so it still ends on the text. */
		.info-strip {
			padding: 48px 0 44px;
		}
		.info-grid {
			gap: 26px;
		}
		.info-col h3 {
			margin-bottom: 10px;
		}
		.info-col p {
			line-height: 1.55;
			margin-bottom: 0;
		}
		.info-col .info-note {
			margin-top: 8px;
		}
		.info-col.contact {
			display: flex;
			flex-wrap: wrap;
			column-gap: 22px;
			margin-bottom: -11px;
		}
		.info-col.contact h3 {
			flex: 0 0 100%;
			margin-bottom: 0;
		}
		.hours-row {
			padding: 7px 0;
		}
	}

	/* ===== SCROLL REVEALS =====
	   One IntersectionObserver sets [data-in] on each [data-reveal] node as it
	   scrolls in; motion is per "kind", tailored to each element's shape.

	   IMPORTANT: these selectors are wrapped in :global(...) (scoped under .page).
	   Svelte's scoped-CSS compiler TREE-SHAKES any selector it can't statically
	   match in the markup — and [data-in] is added at RUNTIME by the observer, so
	   un-globalled `[data-reveal][data-in]` "settled" rules get dropped, leaving
	   every element stuck in its off-state. :global() keeps them; pinning them
	   under the scoped `.page` ancestor stops them leaking to other brands / the
	   shared HomeSections (which uses its own `.reveal`, not `data-reveal`). */

	/* rise — title/lede/buttons: fade + lift, honour an optional --rd stagger */
	.page :global([data-reveal='rise']) {
		opacity: 0;
		transform: translateY(26px);
		transition:
			opacity 0.85s var(--ease-fusion) var(--rd, 0s),
			transform 0.85s var(--ease-fusion) var(--rd, 0s);
	}
	.page :global([data-reveal='rise'][data-in]) {
		opacity: 1;
		transform: translateY(0);
	}

	/* (the 'card' kind — rise + scale-from-0.965, staggered per tile — went with the
	   menu card grid it was written for. Nothing sets data-reveal="card" now, and a
	   :global() rule wouldn't be flagged as dead by svelte-check, so it's removed
	   here rather than left to rot.) */

	/* bleed — the story slab slides in from the edge it runs off, rather than
	   fading up in place like everything else. */
	.page :global([data-reveal='bleed']) {
		opacity: 0;
		transform: translateX(48px);
		transition:
			opacity 0.9s var(--ease-fusion),
			transform 0.9s var(--ease-fusion);
	}
	.page :global([data-reveal='bleed'][data-in]) {
		opacity: 1;
		transform: translateX(0);
	}

	/* words — a headline set word by word: each word rises out of its own line
	   mask, staggered, the way thealchemistbars.com brings its titles in. */
	.page :global([data-reveal='words'] .w) {
		display: inline-block;
		overflow: hidden;
		vertical-align: top;
		padding-bottom: 0.1em;
		margin-bottom: -0.1em;
	}
	.page :global([data-reveal='words'] .wi) {
		display: inline-block;
		transform: translate3d(0, 110%, 0) rotate(5deg);
		transform-origin: left bottom;
		transition: transform 1.1s cubic-bezier(0.16, 1, 0.3, 1) calc(var(--i, 0) * 0.07s + 0.05s);
	}
	.page :global([data-reveal='words'][data-in] .wi) {
		transform: translate3d(0, 0, 0) rotate(0deg);
	}

	/* film — the New Menu frame: lifts in, and its offset hairline frame draws
	   itself round after it. */
	.page :global([data-reveal='film']) {
		opacity: 0;
		transform: translateY(60px);
		transition:
			opacity 1s var(--ease-fusion),
			transform 1.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.page :global([data-reveal='film'][data-in]) {
		opacity: 1;
		transform: none;
	}
	.page :global([data-reveal='film'] .dish-outline) {
		clip-path: inset(0 100% 100% 0 round 22px);
		transition: clip-path 1.6s cubic-bezier(0.65, 0, 0.35, 1) 0.5s;
	}
	.page :global([data-reveal='film'][data-in] .dish-outline) {
		clip-path: inset(0 0 0 0 round 22px);
	}


	/* frame — the What's On banner opens out of an inset, rising into place */
	.page :global([data-reveal='frame']) {
		clip-path: inset(9% 7% round 22px);
		transform: translateY(50px) scale(0.97);
		transition:
			clip-path 1.5s cubic-bezier(0.77, 0, 0.18, 1),
			transform 1.5s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.page :global([data-reveal='frame'][data-in]) {
		clip-path: inset(0 round 22px);
		transform: none;
	}

	/* QUICKER ON A PHONE. A flick lands a section on screen all at once, and at
	   the desktop timings the last staggered line (the story's tag, the menu's
	   PDF links) was not 95% there until 650–710ms and still moving at 900 — a
	   screen of half-faded text. Roughly half the duration, half the travel, and
	   the stagger scaled to 40%: everything is 95% in by ~250–350ms and at rest
	   by ~450. Measured after an instant jump to each section at 390x844. The
	   band's slow push-in is left alone — it never hides anything. */
	@media (max-width: 760px) {
		.page :global([data-reveal='rise']) {
			transform: translateY(14px);
			transition:
				opacity 0.45s var(--ease-fusion) calc(var(--rd, 0s) * 0.4),
				transform 0.45s var(--ease-fusion) calc(var(--rd, 0s) * 0.4);
		}
		.page :global([data-reveal='bleed']) {
			transform: translateX(24px);
			transition:
				opacity 0.45s var(--ease-fusion),
				transform 0.5s var(--ease-fusion);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-curtain {
			display: none;
		}
		/* The cookie-notice lift (phone block above) snaps instead of easing. */
		.hero {
			transition: none;
		}
		.ht-in,
		.hero-logo,
		.hero-eyebrow,
		.hero-line,
		.hero-actions,
		.scroll-cue,
		.hero-bg img {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}
		.scroll-cue .stick::after {
			animation: none;
		}
		/* Buttons keep the colour change, lose the lift, the rise and the glint. */
		.btn:hover,
		.btn:focus-visible,
		.btn:active {
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
		.special-slide,
		.special-slide .slide-bg {
			transition-duration: 0.001ms;
			transition-delay: 0s;
		}
		.special-slide .slide-bg {
			transform: none;
		}
		.page :global([data-reveal]) {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}
		.page :global([data-reveal='frame']) {
			clip-path: none !important;
		}
		.special-slide,
		.special-slide .slide-bg,
		.special-slide .slide-bg .sharp,
		.special-slide .special-copy-inner > :global(*),
		.specials-count .now {
			transition: none !important;
			animation: none !important;
		}
		.specials-tabs button.active::after {
			animation: none;
			transform: scaleX(1);
		}
		.page :global([data-reveal] .wi) {
			transform: none !important;
			transition: none !important;
		}
		.page :global([data-reveal] .dish-outline) {
			clip-path: none !important;
		}
	}

	/* Our Story's wash starts on a hard line against the Doorway's flat ground
	   above it: ease it in instead. */
	.glow-about {
		-webkit-mask-image: linear-gradient(to bottom, transparent, #000 200px);
		mask-image: linear-gradient(to bottom, transparent, #000 200px);
	}
</style>
