<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import { imgAttrs } from '$lib/media/responsive';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import BannerHero from '$lib/components/BannerHero.svelte';
	import HomeSections from '$lib/components/HomeSections.svelte';
	import RestaurantSchema from '$lib/components/RestaurantSchema.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import { onMount } from 'svelte';
	import { isCovered, isEntering } from '$lib/nav/entering';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	import ShowcaseDoorway from '$lib/components/showcase/ShowcaseDoorway.svelte';
	import HomeCards from '$lib/components/HomeCards.svelte';
	import FusionInteriors from '$lib/components/FusionInteriors.svelte';
	import FusionMarquee from '$lib/components/FusionMarquee.svelte';
	import FusionMenuCarousel from '$lib/components/FusionMenuCarousel.svelte';
	import { inviewVideo } from '$lib/data/showcase';
	import { menuFileKind } from '$lib/data/menu-types';

	let { data }: { data: PageData } = $props();
	// Editable copy (with static defaults) + merged brand facts for the Visit block.
	const home = $derived(data.home);
	const info = $derived(data.brandInfo);
	const extra = $derived(data.homeExtra); // marquee words + walk-ins note (editable)
	const brand = getBrand('asia');

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

	/** The Our Story figure — the scroll "window" pans the still inside its frame. */
	let aboutMedia: HTMLElement | undefined = $state();

	/** The hero lede. On a phone it folds away while the cookie notice is up (see
	 *  `--lede-room` in the hero's phone styles); its measured height is published
	 *  as `--lede-h` so the fold's open end is exact. */
	let heroLine: HTMLElement | undefined = $state();

	// Did we arrive from the front door? Then the layout's shoji panels are covering
	// this hero and about to part — so the hero must NOT also run its own curtain,
	// and its copy must rise WHILE the panels open rather than after. Read at
	// component init: the layout consumes the flag in its onMount, and a child's
	// init runs before its parent's onMount, so this is always seen.
	// Without it the arrival stacked two opaque covers in series and the copy only
	// began once both had finished — the "wipe, freeze, then the stuff appears".
	const fromLanding = isEntering();

	// Same story for an intra-Asia navigation: AsiaPageCurtain has dipped the
	// screen to dark, swapped the page behind it and is about to lift. Playing the
	// hero's own curtain under that lift is the same two-covers-in-series mistake,
	// and it was showing as a second wipe once the dip had gone.
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

		// NOTE: the hero portrait is deliberately NOT parallaxed. Any drift needs an
		// oversized scale() to cover the gap it opens, and that re-crops the frame —
		// the composition (figure right, gold disc, black left rail) is the design.

		if (reduce) {
			entered = true;
			return () => io?.disconnect();
		}
		// --- "Our Story" window: the still inside the frame drifts against its
		// opening as the section crosses the viewport, so the visible crop tracks
		// the scroll position. --pan runs +1 (top of the still) → -1 (bottom); the
		// CSS turns that into half the frame's spare height either way. Writing a
		// custom property that only feeds a transform keeps this on the compositor.
		let panFrame = 0;
		const pan = () => {
			panFrame = 0;
			const el = aboutMedia;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const vh = window.innerHeight || 1;
			// 0 as the figure's top reaches the bottom edge, 1 as its bottom clears the top.
			const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
			el.style.setProperty('--pan', (1 - 2 * p).toFixed(4));
		};
		// Only while the figure is on (or about to be on) screen. Ungated, this
		// measured and re-styled the figure on every scroll frame of a 14-screen
		// page — some 700 times top to bottom, for the ~75 frames it is in view.
		// The observer also runs it once on the way out, so the crop is parked at
		// its end stop rather than wherever the last gated frame left it.
		let panLive = false;
		const onScroll = () => {
			if (panLive && !panFrame) panFrame = requestAnimationFrame(pan);
		};
		const panIo = new IntersectionObserver(
			(entries) => {
				panLive = entries[entries.length - 1].isIntersecting;
				if (!panFrame) panFrame = requestAnimationFrame(pan);
			},
			{ rootMargin: '120px 0px' }
		);
		if (aboutMedia) panIo.observe(aboutMedia);
		pan();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });

		// --- Hero lede height, for the phone fold (see `.hero-line`'s max-height).
		// scrollHeight reads the full text height even while the fold has it at 0.
		// Measured again once the webfont lands (it can change the line count) and
		// on resize/rotate. Not needed under reduced motion — nothing eases there,
		// and the CSS falls back to a loose cap.
		const measureLede = () => {
			const el = heroLine;
			if (el) el.style.setProperty('--lede-h', `${el.scrollHeight}px`);
		};
		measureLede();
		document.fonts?.ready.then(measureLede).catch(() => {});
		window.addEventListener('resize', measureLede, { passive: true });

		// Double rAF — see note above.
		let id2 = 0;
		const id1 = requestAnimationFrame(() => {
			id2 = requestAnimationFrame(() => (entered = true));
		});
		return () => {
			cancelAnimationFrame(id1);
			cancelAnimationFrame(id2);
			if (panFrame) cancelAnimationFrame(panFrame);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			window.removeEventListener('resize', measureLede);
			panIo.disconnect();
			io?.disconnect();
		};
	});

	// Hero portrait + feature stills — editable from admin → Content → Media (with the
	// original assets as fallback). Full-bleed bands break up the page (Tattu-style).
	const roomImage = $derived(data.media.roomImage);
	const blossomImage = $derived(data.media.blossomImage);

	// Resolve each slot to its optimized AVIF/WebP ladder. A CMS-uploaded URL that
	// has no variants (or the shipped static hero) passes straight through.
	// The photographs below the first screen tell a phone they are 85vw wide when
	// they are in fact full width: a 3x phone then fetches the 1024px variant, not
	// the 1600px one — under half the bytes for a difference the eye doesn't find.
	// (Same note, at more length, on the Fusion page.)
	// "Step into Geisha Asia" — the room section's copy. Deliberately NOT the story
	// block's "Our unique setting…" sentence again (owner, Oct 2026): same idea,
	// told from the door in.
	const STEP_INSIDE =
		'Walk in beneath a canopy of blossom trees and glowing red lanterns, with hand-painted geishas watching over the room. It is a Japanese garden brought indoors, made for long dinners with the family, a quiet table for two or a lively night with friends, with the best of pan-Asian cooking at the centre of it all.';

	const PHONE_CAP = '(max-width: 760px) 85vw';
	// The hero is the geisha-and-blossom dining room artwork (owner, Oct 2026),
	// shipped with the site rather than read from the CMS hero slot.
	const hero = {
		src: '/images/asia/hero/asia-geisha-hero-1672.webp',
		srcset:
			'/images/asia/hero/asia-geisha-hero-960.webp 960w, /images/asia/hero/asia-geisha-hero-1672.webp 1672w',
		sizes: '(orientation: portrait) 190vh, 100vw',
		width: 1672,
		height: 941
	};
	const room = $derived(imgAttrs(roomImage, `${PHONE_CAP}, 100vw`));
	const blossom = $derived(imgAttrs(blossomImage, `${PHONE_CAP}, 100vw`));


	// The "Our Story" stat row (days open / kitchen hours / menus to explore) was
	// removed, along with the daysOpen + kitchenSpan derivations and the shortTime
	// helper that fed it. `hours` is still used further down for the Specials
	// copy, so it stays.

	// ===== SPECIALS SLIDER =====
	// One slide per live offer (the same list the What's On page and the admin
	// Offers editor use). An offer with no image of its own borrows from the
	// gallery so a slide is never a bare gradient.
	// Food shots first: the gallery also holds interiors and portraits, and a
	// cropped close-up of the lucky cat makes a poor banner for a set menu.
	const fallbackPool = $derived.by(() => {
		const food = data.gallery.filter((g) => g.category === 'food');
		return food.length ? food : data.gallery;
	});
	// Poster artwork for offers whose saved copy has no picture of its own (the
	// live content can predate the artwork) — matched by offer id or title.
	const POSTERS: Record<string, string> = {
		evening: '/images/asia/specials/asia-special-menu.webp',
		'evening special': '/images/asia/specials/asia-special-menu.webp',
		'2for14': '/images/asia/specials/asia-cocktails.webp',
		'2 for £14 cocktails': '/images/asia/specials/asia-cocktails.webp',
		brunch: '/images/asia/specials/asia-bottomless-brunch.webp',
		'bottomless brunch': '/images/asia/specials/asia-bottomless-brunch.webp'
	};
	// The new posters win over older saved artwork for the same offer.
	const withPoster = (o: (typeof data.offers)[number]) => {
		const art = POSTERS[o.id] ?? POSTERS[(o.title ?? '').toLowerCase()];
		return art ? { ...o, img: art, imgFit: 'poster' as const } : o;
	};
	const specials = $derived(
		data.offers.map(withPoster).map((o, i) => ({
			...o,
			image: o.img || fallbackPool[i % Math.max(fallbackPool.length, 1)]?.src || '',
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
	/** A finger is down on the banner. Touch has no hover, so this is the phone's
	 *  "held while the pointer is inside". */
	let specialsTouched = $state(false);
	/** The banner is on screen. Autoplay ran regardless — it was turning slides
	 *  over ten screens away, so what you scrolled back to was never what you left. */
	let specialsInView = $state(false);
	let specialsEl: HTMLElement | undefined = $state();

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

	$effect(() => {
		const el = specialsEl;
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => (specialsInView = entries[entries.length - 1].isIntersecting),
			{ threshold: 0.4 }
		);
		io.observe(el);
		return () => io.disconnect();
	});

	// Autoplay: 7s a slide, held while the pointer/focus/a finger is inside the
	// banner or the banner is off screen, and switched off entirely under reduced
	// motion.
	// A timeout per slide, not one interval: reading `specialIndex` here re-runs
	// the effect on every change, so the 7s starts again from whatever put the
	// slide up. On the interval, tapping an arrow late in a slide's turn showed
	// the one you asked for for a fraction of a second before autoplay took it
	// away (a tapped button is not focused on iOS, so the focus hold never came).
	$effect(() => {
		const from = specialIndex;
		if (specialsPaused || specialsTouched || !specialsInView || specials.length < 2) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const id = setTimeout(() => goSpecial(from + 1), 7000);
		return () => clearTimeout(id);
	});
</script>

<!-- Hours in the description come from the live service periods, not a
     hardcoded string, so search snippets track the diary. -->
<Seo
	title="Geisha Asia — Modern Japanese-inspired · pan-Asian"
	description="Geisha Asia, Benton. A modern, Japanese-inspired pan-Asian restaurant — sushi, dim sum, robata grill and more.{hours.strap
		? ` ${hours.strap}.`
		: ''}"
/>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Space+Grotesk:wght@300;400;500&display=swap"
		rel="stylesheet"
	/>
	<!-- Redesign type pair (hero, story and specials; the rest of the page follows). -->
	<link
		href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;700&family=Jost:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<RestaurantSchema {brand} reviews={data.reviews} {hours} />

<div class="page" data-brand="asia">
	<!-- HERO — full-bleed portrait, copy stacked left over a horizontal ink scrim.
	     The wordmark sits at the head of the copy stack (as in the design template).
	     A staged entry animation runs on load (curtain lifts → wordmark → eyebrow →
	     title lines clip-rise → lede → actions → scroll cue). -->
	<section class="hero" class:enter={entered} class:from-landing={covered}>
		<!-- Only for a direct visit or a hard refresh. Arriving from the front door
		     the layout's shoji panels are the curtain, and arriving from another Asia
		     page the dip already is — both suppress this one (see .from-landing). -->
		{#if !covered}
			<div class="hero-curtain" aria-hidden="true"></div>
		{/if}

		<div class="hero-bg">
			<img {...hero} alt="" fetchpriority="high" />
		</div>

		<div class="hero-inner">
			<div class="hero-copy">
				<a class="hero-logo" href="/" aria-label="Geisha — home">
					<img src="/geisha-asia-wordmark.png" alt="Geisha Asia" width="1554" height="461" />
				</a>
				<span class="hero-eyebrow">{home.heroEyebrow}</span>
				<h1 class="hero-title">
					{#each home.heroTitleLines as line}
						<span class="ht-line"><span class="ht-in"><RichText text={line} /></span></span>
					{/each}
				</h1>
				<p class="hero-line" bind:this={heroLine}>{home.heroLine}</p>
				<div class="hero-actions">
					<a class="btn btn-solid" href={brand.bookingUrl}>Book a Table</a>
					<a class="btn" href="/asia/menus">View the Menu</a>
				</div>
			</div>
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

	<!-- STEP INSIDE — the Asia interiors: copy left, the Interiors film centre, a
	     gallery of the room right (same layout as Fusion's; see FusionInteriors). -->
	<FusionInteriors
		brand="asia"
		eyebrow="Japanese-garden dining"
		line="Step into Geisha Asia."
		body={STEP_INSIDE}
		bookingUrl={brand.bookingUrl}
	/>
	<FusionMarquee
		brand="asia"
		items={['Blossom canopy', 'Red lanterns', 'Sushi & sashimi', 'Dim sum', 'Robata grill', 'Cocktails']}
	/>

	<!-- OUR STORY — copy left, the "Rooted in tradition" film right, in a gold
	     hairline frame that draws itself in (same layout as Fusion's story). -->
	<section class="about" id="about">
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

			<div class="about-media" data-reveal="film" bind:this={aboutMedia}>
				<span class="dish-outline" aria-hidden="true"></span>
				<div class="dish-frame">
					<video
						use:inviewVideo={{ fetchAt: '40% 0px' }}
						data-src="/videos/asia/rooted.mp4"
						data-poster="/videos/asia/rooted-poster.webp"
						muted
						loop
						playsinline
						preload="none"
						aria-label="Dim sum, robata, sushi and cocktails at Geisha Asia"
					></video>
				</div>
			</div>
		</div>
	</section>
	<FusionMarquee
		brand="asia"
		variant="outline"
		reverse
		speed={0.7}
		items={['Daytime Special', 'Evening Special', '2 for £14 Cocktails', 'Bottomless Brunch', 'Kids Menu', 'Drinks Menu']}
	/>

	<!-- SPECIALS — full-bleed cinematic banner, one slide per live offer.
	     Replaces the old full-width grill band. -->
	{#if specials.length}
		<section class="specials" id="specials" aria-label="What's on at Geisha Asia">
			<div
				class="specials-slider"
				class:paused={specialsPaused || specialsTouched}
				data-reveal="frame"
				bind:this={specialsEl}
				onmouseenter={() => (specialsPaused = true)}
				onmouseleave={() => (specialsPaused = false)}
				onfocusin={() => (specialsPaused = true)}
				onfocusout={() => (specialsPaused = false)}
				ontouchstart={() => (specialsTouched = true)}
				ontouchend={() => (specialsTouched = false)}
				ontouchcancel={() => (specialsTouched = false)}
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
									href={s.href ?? '/asia/offers'}
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

	<!-- MENUS: 3D coverflow of the menus, opening on the Main Menu mid-row (same
	     component as Fusion's, in Asia's colours and covers). -->
	<FusionMenuCarousel brand="asia" menus={data.menuIndex} />
</div>

<!-- DENSITY SECTIONS (shared, real data) — gallery, reviews, order and Instagram.
     The design template has no equivalent for these, so they're left in place and
     take the new palette from the Asia brand tokens instead. -->
<div data-brand="asia">
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

<div class="page" data-brand="asia">
	<!-- RESERVE — the template's closing call to action -->
	<section class="reserve">
		<div class="reserve-bg">
			<img {...blossom} alt="" loading="lazy" />
		</div>
		<div class="reserve-inner" data-reveal="rise">
			<span class="eyebrow">Reserve Your Experience</span>
			<h2>Book your table at {brand.name}</h2>
			<p>
				Join us for an unforgettable dining experience — we look forward to welcoming you to {info
					.address.line1}, {info.address.city}.
			</p>
			<a class="btn btn-solid" href={brand.bookingUrl}>Book Now</a>
			<!-- Only when there is a note: an empty <p> would still carry its margin
			     and leave the band deeper under the button than above the eyebrow. -->
			{#if extra.walkinsNote}
				<p class="reserve-note"><em>{extra.walkinsNote}</em></p>
			{/if}
		</div>
	</section>

	<!-- INFO STRIP — visit, contact and the LIVE opening times -->
	<section class="info-strip" id="visit">
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

<div data-brand="asia">
	<SiteFooter {brand} />
</div>

<style>
	/* Both read the brand tokens now instead of hardcoding the old warm browns, so
	   the page ground matches the shared sections sandwiched between these blocks. */
	/* No `background` — see the note in fusion/+page.svelte. A ground set from a
	   route's `:global(body)` outlives that route and leaks across brands. */
	:global(body) {
		margin: 0;
		color: var(--ink, #f5f1e8);
		font-family: var(--font-body, 'Jost', system-ui, sans-serif);
		font-feature-settings: 'liga', 'dlig';
	}

	.page {
		--ease-asia: cubic-bezier(0.2, 0.8, 0.2, 1);
		background: var(--page-bg);
		color: var(--ink);
		font-family: var(--font-body);
		overflow-x: clip;
	}
	/* Only the first .page block owns the hero and needs to fill the viewport; the
	   second (reserve + info strip) would otherwise reserve a screenful of dead
	   ground under itself. */
	.page:first-of-type {
		/* svh, not vh: on a phone `100vh` is the LARGE viewport (address bar hidden),
		   so at rest the hero stands taller than what you can actually see and the
		   bottom of it — the CTAs and the scroll cue — sits under the browser chrome.
		   svh is the small viewport, which fits in the worst case and, unlike dvh,
		   doesn't re-lay-out every time the bar slides. vh first, for anything old
		   enough not to know the unit. */
		min-height: 100vh;
		min-height: 100svh;
	}

	/* ===== HERO =====
	   Ported from the redesign template: a full-bleed portrait, a horizontal ink
	   scrim reading left→right, and the copy stack pinned to the left rail of a
	   1240px container. The design tokens are declared on `.hero` rather than
	   `.page` on purpose — only the hero has been redesigned so far, so the rest
	   of the page keeps its current look until it follows. */
	.hero {
		--ink: #08080b;
		--hair: rgba(255, 255, 255, 0.12);
		--gold: #d4af37;
		--ivory: #f5f1e8;
		--muted: #a3a0a0;
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--sakura-glow: rgba(239, 60, 92, 0.4);
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);

		position: relative;
		/* border-box, or the 250px of padding is added on top of the 100vh and the
		   hero overshoots the viewport (which pushes the copy down and the scroll
		   cue off-screen). The template gets this from its global `* { box-sizing }`. */
		box-sizing: border-box;
		/* See the note on `.page:first-of-type` — same reason. */
		min-height: 100vh;
		min-height: 100svh;
		display: flex;
		align-items: center;
		justify-content: flex-start;
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
		/* Holds the face and the gold disc in frame as the viewport narrows. */
		object-position: 70% 28%;
		display: block;
	}
	/* Two scrims: a left→right ink wash so the copy sits on near-solid black
	   without dimming the portrait itself, plus a top/bottom fade into the page.
	   They live on .hero-bg, not the <img>, so the parallax drift can't slide the
	   scrim off the copy. */
	.hero-bg::after {
		content: '';
		position: absolute;
		inset: 0;
		background:
			linear-gradient(
				90deg,
				var(--ink) 0%,
				rgba(10, 9, 8, 0.86) 24%,
				rgba(10, 9, 8, 0.4) 48%,
				rgba(10, 9, 8, 0.05) 68%,
				transparent 82%
			),
			linear-gradient(
				0deg,
				rgba(10, 9, 8, 0.55) 0%,
				transparent 22%,
				transparent 78%,
				rgba(10, 9, 8, 0.6) 100%
			);
	}

	.hero-inner {
		position: relative;
		z-index: 2;
		width: 100%;
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 32px;
		box-sizing: border-box;
	}
	.hero-copy {
		max-width: 600px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
	}
	/* The template's wordmark PNG carries ~6% transparent padding; ours is trimmed
	   to the ink, so the box is sized to land on the same optical width (258px at
	   the 600px copy column) and the bottom margin absorbs the padding it lost. */
	.hero-logo {
		display: block;
		width: 43%;
		max-width: 280px;
		margin: 8px 0 37px;
		filter: drop-shadow(0 12px 34px rgba(0, 0, 0, 0.55));
	}
	.hero-logo img {
		width: 100%;
		height: auto;
		display: block;
	}
	/* Spaced gold caps preceded by a short rule. */
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
	.hero-eyebrow::before {
		content: '';
		flex: none;
		width: 34px;
		height: 1px;
		background: var(--gold);
	}
	.hero-title {
		font-family: var(--display);
		font-weight: 600;
		font-size: clamp(2.6rem, 6.4vw, 4.6rem);
		line-height: 1.02;
		letter-spacing: 0.01em;
		color: var(--ivory);
		margin: 20px 0 24px;
	}
	/* :global — the <em> is rendered inside the RichText child component, so the
	   scoped selector wouldn't reach it. The accent line ("*Asia*") is the sakura
	   one; it isn't italicised here, so the emphasis reads as colour alone. */
	.hero-title :global(em) {
		font-style: normal;
		font-weight: inherit;
		color: var(--sakura-2);
	}
	.hero-line {
		font-family: var(--body-f);
		font-weight: 300;
		font-style: normal;
		font-size: 1.05rem;
		line-height: 1.6;
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
	/* CENTRED (owner, Oct 2026 — the same layout as Fusion): the wordmark,
	   eyebrow, headline, line and buttons stand in the middle of the artwork,
	   which is faded down a step and a little deeper behind the type. */
	.hero {
		justify-content: center;
		text-align: center;
	}
	.hero-inner {
		display: flex;
		justify-content: center;
	}
	.hero-copy {
		max-width: 820px;
		align-items: center;
		text-align: center;
	}
	.hero-line {
		max-width: 560px;
		margin-left: auto;
		margin-right: auto;
	}
	.hero-actions {
		justify-content: center;
	}
	.hero-eyebrow::after {
		content: '';
		flex: none;
		width: 34px;
		height: 1px;
		background: var(--gold);
	}
	.hero-bg img {
		object-position: 50% 40%;
	}
	.hero-bg::after {
		background:
			radial-gradient(ellipse 55% 52% at 50% 52%, rgba(8, 8, 11, 0.5), transparent 75%),
			linear-gradient(0deg, rgba(8, 8, 11, 0.6) 0%, transparent 24%, transparent 78%, rgba(8, 8, 11, 0.6) 100%),
			rgba(8, 8, 11, 0.42);
	}

	/* Buttons — the hover is one idea in two registers: a soft lift, a single
	   specular sheen crossing the face, and (outline only) sakura ink rising
	   from the bottom edge with a curved meniscus that flattens as it fills.
	   .btn-solid is already filled, so instead of the fill its gradient drifts
	   across while the shadow blooms underneath it.
	   ::before is the ink, ::after the sheen — both sit under the label via
	   z-index -1 inside the button's own stacking context (z-index: 0). */
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
	   can own `transform` without fighting it. Back at the template's 30px now the
	   floating bottom nav pill it used to clear has been replaced by the top bar. */
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
		background: var(--sakura-2);
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

	@media (max-width: 600px) {
		/* A phone can't hold the desktop composition (copy on a black left rail,
		   figure to the right): the crop is a narrow slice with her face in the
		   middle of it, and a centred copy stack printed the wordmark across her
		   eyes and the headline across her mouth. So the portrait takes the top of
		   the screen and the copy sits under it — bottom-anchored, on ink. The 92px
		   foot keeps the buttons clear of the Ask Geisha button in the corner. */
		.hero {
			align-items: flex-end;
			padding: 120px 20px calc(92px + var(--cb-lift));
			transition: padding-bottom 0.35s var(--ease);

			/* FIRST VISIT: the cookie notice is fixed to the bottom of the screen and
			   on a phone it lands exactly on the two buttons. CookieBanner publishes
			   its height on <html> as `--cb-h` (unset once dismissed), so the stack is
			   lifted by what the notice takes beyond the 92px foot that was already
			   clear — `--cb-lift`, which leaves the buttons 20px above it and is 0
			   with no notice. The padding eases, so the copy settles back down when
			   Reject/Accept is tapped instead of dropping. */
			--cb-lift: max(0px, calc(var(--cb-h, 0px) - 72px));
			/* ...but the stack may never climb back over her face, and with the notice
			   up on an iPhone (toolbars showing: 664px) there is not room for the face
			   AND all four pieces of copy. So the lede gives way: `--lede-room` is the
			   space left between her chin (41.5% down the frame — the portrait is
			   height-led, so that holds at every size) and the top of the full stack
			   (289px of copy + the 92px foot + the lift). Positive, the lede shows;
			   negative, it folds to nothing (see .hero-line) and the eyebrow, headline
			   and buttons keep their place under her chin. The same rule keeps the
			   copy off her face on very short screens with no notice at all. */
			--hero-h: 100vh;
			--lede-room: calc(var(--hero-h) * 0.585 - 385px - var(--cb-lift));
			/* 104px while the lede is showing (its three lines + margin), 0 folded. */
			--lede-on: clamp(0px, calc(var(--lede-room) * 100), 104px);
			/* How far the copy has actually risen, for the scrim below. */
			--copy-rise: max(0px, calc(var(--cb-lift) - 104px + var(--lede-on)));
			/* LAST RESORT, for a frame too short even with the lede folded (the notice
			   up on an iPhone mini or a 360x640 Android): the portrait itself rides
			   up by the shortfall — 281px is the folded stack + foot + 4px of air —
			   so her chin still clears the eyebrow. Capped at a quarter of the frame
			   less the bar, where her brow would start to go under the wordmark.
			   Fusion moves its artwork with the copy in every banner-up state; here
			   that was tried and dropped — riding up the full 100px at 390x664 put
			   the top bar's wordmark across her forehead and cut the hairpiece off. */
			--face-lift: clamp(
				0px,
				calc(281px + var(--cb-lift) - var(--hero-h) * 0.585),
				calc(var(--hero-h) * 0.25 - 76px)
			);
			--scrim-rise: calc(var(--copy-rise) + var(--face-lift));
		}
		@supports (height: 100svh) {
			.hero {
				--hero-h: 100svh;
			}
		}
		.hero-inner {
			padding: 0;
		}
		/* The top bar carries this same wordmark ~100px above; a second, larger
		   copy straight under it is what pushed the stack up over the face. */
		.hero-logo {
			display: none;
		}
		/* Shorter than the frame, so her chin clears the eyebrow even at the small
		   viewport (address bar showing). `cover` on a portrait box is height-led,
		   so this is the only handle on where the face lands vertically. */
		/* `translate`, not `transform` — the entry push-in owns that. 0 on any
		   ordinary phone; see --face-lift on .hero. */
		.hero-bg img {
			height: 82%;
			object-position: 20% 30%;
			translate: 0 calc(var(--face-lift) * -1);
		}
		/* Vertical scrims in place of the left→right wash: a top fade for the bar,
		   clear across the face, then down to solid ink where the image ends. The
		   ink climbs with the copy while the cookie notice holds it up (and with
		   the portrait, if that has had to move); the clear band's own stop stays
		   put, so her eyes are never dimmed. */
		.hero-bg::after {
			background: linear-gradient(
				180deg,
				rgba(8, 8, 11, 0.72) 0%,
				rgba(8, 8, 11, 0) 15%,
				rgba(8, 8, 11, 0) 34%,
				rgba(8, 8, 11, 0.6) calc(52% - var(--scrim-rise)),
				rgba(8, 8, 11, 0.92) calc(70% - var(--scrim-rise)),
				var(--ink) calc(82% - var(--scrim-rise))
			);
		}
		.hero-title {
			margin: 16px 0 18px;
		}
		/* Folds away when there is no room for it under her chin — see --lede-room
		   on .hero. Any negative room, times 100, clamps both of these to 0; any
		   positive room clamps them to their natural values. (The easing for the
		   fold is with the entry choreography below, which owns this transition.) */
		/* `--lede-h` is the lede's own measured height, set from onMount. It is the
		   open end of the fold so that the unfold and the hero's padding cover the
		   same distance on the same curve — with a loose cap (the 12em fallback)
		   the lede sprang open in the first 60ms and bounced the headline 34px up
		   over her chin before the padding caught up. */
		.hero-line {
			font-size: 1rem;
			line-height: 1.55;
			overflow: hidden;
			max-height: clamp(0px, calc(var(--lede-room) * 100), var(--lede-h, 12em));
			margin-bottom: clamp(0px, calc(var(--lede-room) * 100), 30px);
		}
		.hero-actions {
			gap: 12px;
		}
		.btn {
			padding: 14px 22px;
			letter-spacing: 0.18em;
		}
		.scroll-cue {
			display: none;
		}
	}

	/* ===== HERO ENTRY CHOREOGRAPHY =====
	   Every delay below is `--t0 + n`, where --t0 is when the hero is first VISIBLE.
	   That single variable is what makes one choreography serve both arrivals:

	     direct visit    the hero's own curtain lifts, so --t0 waits for it (0.34s)
	     from the front  the layout's shoji panels are the curtain and are already
	     door            parting, so --t0 is 0 and the copy rises THROUGH the open —
	                     concurrent, not sequential

	   The old timings were absolute and tuned for the curtain alone, so arriving
	   from the landing they ran after a second cover had already finished: the last
	   element landed ~2.1s in, with the hero image sitting bare for most of it. */
	.hero {
		--t0: 0.34s;
	}
	.hero.from-landing {
		--t0: 0s;
	}

	.hero-curtain {
		position: absolute;
		inset: 0;
		z-index: 5;
		/* Flat --ink. The old gradient ran down to #160f0b, a warm brown from the
		   pre-redesign palette, so the wipe was visibly a different colour from the
		   page ground, the shoji and the page dip — all of which are #08080b. */
		background: #08080b;
		transform-origin: top;
		transition: transform 0.8s cubic-bezier(0.76, 0, 0.24, 1);
		pointer-events: none;
	}
	.hero.enter .hero-curtain {
		transform: scaleY(0);
	}

	/* The portrait settles out of a slight push-in as it's revealed, so the reveal
	   has depth instead of being a static frame appearing behind moving panels. */
	.hero-bg img {
		transform: scale(1.055);
		transition: transform 1.6s cubic-bezier(0.22, 0.9, 0.3, 1);
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
		transition: transform 0.86s var(--ease-asia);
	}
	.hero.enter .ht-in {
		transform: translateY(0);
	}
	.ht-line:nth-child(1) .ht-in {
		transition-delay: calc(var(--t0) + 0.26s);
	}
	.ht-line:nth-child(2) .ht-in {
		transition-delay: calc(var(--t0) + 0.36s);
	}

	/* Wordmark / eyebrow / lede / actions / scroll cue: fade + small rise */
	.hero-logo,
	.hero-eyebrow,
	.hero-line,
	.hero-actions,
	.scroll-cue {
		opacity: 0;
		transform: translateY(14px);
		transition:
			opacity 0.7s var(--ease-asia),
			transform 0.7s var(--ease-asia);
	}
	.hero.enter .hero-logo,
	.hero.enter .hero-eyebrow,
	.hero.enter .hero-line,
	.hero.enter .hero-actions,
	.hero.enter .scroll-cue {
		opacity: 1;
		transform: translateY(0);
	}
	.hero.enter .hero-logo {
		transition-delay: calc(var(--t0) + 0.1s);
	}
	.hero.enter .hero-eyebrow {
		transition-delay: calc(var(--t0) + 0.18s);
	}
	.hero.enter .hero-line {
		transition-delay: calc(var(--t0) + 0.46s);
	}
	.hero.enter .hero-actions {
		transition-delay: calc(var(--t0) + 0.56s);
	}
	.hero.enter .scroll-cue {
		transition-delay: calc(var(--t0) + 0.7s);
	}
	/* Phones: the lede also folds and unfolds with the cookie notice (see the
	   hero's phone block). That is a third and fourth property on the same
	   transition, and they must not inherit the entry delay — the fold has to
	   keep time with the 0.35s the hero's padding takes. Down here because the
	   rules above would otherwise win on source order. Same for the portrait's
	   last-resort `translate`, alongside its entry push-in. */
	@media (max-width: 600px) {
		.hero-bg img {
			transition:
				transform 1.6s cubic-bezier(0.22, 0.9, 0.3, 1),
				translate 0.35s var(--ease);
		}
		.hero-line {
			transition:
				opacity 0.7s var(--ease-asia),
				transform 0.7s var(--ease-asia),
				max-height 0.35s var(--ease),
				margin-bottom 0.35s var(--ease);
		}
		.hero.enter .hero-line {
			transition-delay: calc(var(--t0) + 0.46s), calc(var(--t0) + 0.46s), 0s, 0s;
		}
	}

	/* ===== SECTION ACCENT (small gold diamond between two rules) ===== */
	.mark-accent {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.9rem;
		margin-bottom: 1.6rem;
	}
	.mark-accent::before,
	.mark-accent::after {
		content: '';
		width: 42px;
		height: 1px;
		background: linear-gradient(to right, transparent, rgba(184, 114, 42, 0.7));
	}
	.mark-accent::after {
		background: linear-gradient(to left, transparent, rgba(184, 114, 42, 0.7));
	}
	.mark-accent span {
		width: 6px;
		height: 6px;
		background: #b8722a;
		transform: rotate(45deg);
		flex: none;
	}

	/* ===== OUR STORY + SPECIALS (ported from the redesign template) =====
	   Both sections carry their own token block for the same reason the hero does:
	   the rest of this page still runs the old palette, so the new one stays
	   contained until those sections are redesigned too. */
	.about,
	.specials {
		--ink: #08080b;
		--panel: #131316;
		--hair: rgba(255, 255, 255, 0.12);
		--gold: #d4af37;
		--gold-bright: #f4cf6b;
		--ivory: #f5f1e8;
		--muted: #a3a0a0;
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--sakura-glow: rgba(239, 60, 92, 0.4);
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);
	}

	/* Shared with the hero's eyebrow, but as a plain class so both the story block
	   and each special slide can use it. currentColor on the rule lets the slides
	   tint it brighter without repeating the geometry. */
	.about .eyebrow,
	.special-copy .eyebrow {
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
	}
	.about .eyebrow::before,
	.special-copy .eyebrow::before {
		content: '';
		flex: none;
		width: 34px;
		height: 1px;
		background: currentColor;
	}

	/* ===== OUR STORY =====
	   Copy left, the "Rooted in tradition" film right — the same layout as
	   Fusion's story, in Asia's colours. The film is square, shown whole. */
	.about {
		position: relative;
		background: var(--panel);
		padding: 120px 0;
		overflow: hidden;
	}
	.about-grid {
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 32px;
		box-sizing: border-box;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: clamp(40px, 6vw, 96px);
		align-items: center;
	}
	.about-copy {
		max-width: 560px;
	}
	.about-media {
		position: relative;
		height: clamp(440px, 68vh, 640px);
		aspect-ratio: 1 / 1;
	}
	.dish-frame,
	.dish-outline {
		position: absolute;
		inset: 0;
		border-radius: 24px;
	}
	/* Offset gold hairline frame, drawn in once the section arrives. */
	.dish-outline {
		transform: translate(-20px, -20px);
		border: 1px solid rgba(212, 175, 55, 0.55);
		pointer-events: none;
	}
	.dish-frame {
		overflow: hidden;
		background: #050507;
		box-shadow:
			0 60px 120px -40px rgba(0, 0, 0, 0.9),
			0 0 0 1px rgba(212, 175, 55, 0.25);
	}
	.dish-frame video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	/* A short gold rule and small caps under the copy. */
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
		font-size: clamp(2rem, 4vw, 3rem);
		line-height: 1.08;
		letter-spacing: 0.01em;
		color: var(--ivory);
		margin: 22px 0 26px;
	}
	.about-copy p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1.02rem;
		line-height: 1.6;
		color: var(--muted);
		margin: 0 0 20px;
	}
	/* The lead paragraph reads a step brighter and larger than the two under it. */
	.about-copy p:first-of-type {
		color: var(--ivory);
		font-size: 1.15rem;
	}

	/* ===== SPECIALS =====
	   A framed 16:9 banner inside the page container — the shape of the poster
	   artwork, so posters fill it exactly. Nothing is cropped or stretched: posters
	   are contained, and a photo slide shows its photo whole in a panel on the
	   right beside the copy. Slides wipe in over each other; the frame stays fixed
	   so the page never jumps on autoplay. (Same as Fusion's.) */
	.specials {
		position: relative;
		background: var(--ink);
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
		background: #08080b;
		box-shadow:
			0 60px 120px -50px rgba(0, 0, 0, 0.9),
			0 0 0 1px rgba(212, 175, 55, 0.22);
	}
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
		color: rgba(245, 241, 232, 0.7);
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
		background: #0a0908;
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
		background: linear-gradient(0deg, rgba(10, 9, 8, 0.55) 0%, transparent 22%);
	}
	.special-slide::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background: linear-gradient(90deg, rgba(10, 9, 8, 0.9) 0%, rgba(10, 9, 8, 0.6) 45%, transparent 62%);
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
		font-size: clamp(2rem, 4.4vw, 3.4rem);
		line-height: 1.06;
		color: var(--ivory);
		margin: 16px 0 14px;
	}
	.special-copy p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1.02rem;
		line-height: 1.6;
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
		background: var(--hair);
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
		background: rgba(10, 9, 8, 0.5);
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

	@media (max-width: 1080px) {
		.about-grid {
			grid-template-columns: 1fr;
			gap: 60px;
		}
		.about-media {
			justify-self: center;
			height: min(72vw, 560px);
		}
	}
	@media (max-width: 760px) {
		.about {
			padding: 70px 0;
		}
		.about-grid {
			padding: 0 20px;
			gap: 48px;
		}
		.about-media {
			height: auto;
			width: calc(100% - 12px);
			margin-left: 12px;
		}
		.dish-outline {
			transform: translate(-12px, -12px);
		}
		/* Phone: the picture on top at its true 16:9 (a poster fills it exactly,
		   a photo sits whole in its own blurred copy), and the copy, button and
		   controls on the panel underneath — never printed over it. */
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
		.specials-count {
			display: none;
		}
		/* "Sun–Thu all day / Fri & Sat 12–4:30pm" at 0.32em tracking broke after
		   "12–" and left the time on a line of its own. Tighter tracking and a
		   shorter rule hold it to one line at 390px; narrower than that it wraps
		   in balanced halves ("… all day /" over "Fri & Sat 12–4:30pm"), with the
		   rule kept on the first line instead of floating between the two. */
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
		/* The bars stay 3px to look at, but each gets a 31px-tall hit area. */
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
		/* The active rule's `background` shorthand resets the clip. */
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
	}

	@media (prefers-reduced-motion: reduce) {
		.special-slide,
		.special-slide .slide-bg {
			transition-duration: 0.001ms;
			transition-delay: 0s;
		}
		.special-slide .slide-bg {
			transform: none;
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
	}

	/* ===== MENU TILES + RESERVE + INFO STRIP (ported from the redesign template) =====
	   Same self-contained token block as the hero/story/specials, for the same
	   reason: the shared sections below still run the old Asia palette until the
	   brand tokens follow. */
	.menu,
	.reserve,
	.info-strip {
		--ink: #08080b;
		--panel: #131316;
		--panel-2: #1a1a1f;
		--hair: rgba(255, 255, 255, 0.12);
		--gold: #d4af37;
		--gold-bright: #f4cf6b;
		--ivory: #f5f1e8;
		--muted: #a3a0a0;
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--sakura-glow: rgba(239, 60, 92, 0.4);
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);
	}

	.menu .eyebrow,
	.reserve .eyebrow {
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
	}
	.menu .eyebrow::before,
	.reserve .eyebrow::before {
		content: '';
		flex: none;
		width: 34px;
		height: 1px;
		background: currentColor;
	}

	/* ===== MENU TILES ===== */
	.menu {
		position: relative;
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
	   Stacked in one narrow 640px column it left a screen-wide hole to its right
	   and wrapped the title to four lines. */
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
		font-size: clamp(2.1rem, 4vw, 3.2rem);
		line-height: 1.08;
		letter-spacing: 0.01em;
		color: var(--ivory);
		margin: 0;
		max-width: 16ch;
	}
	.section-head .lead {
		margin: 0 0 6px;
		max-width: 46ch;
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1.02rem;
		line-height: 1.6;
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

	/* The printed spreads. A gold hairline and an ink mat frame each page like a
	   menu on a table; the sheet lifts a little on hover, the way the buttons do.
	   The pages are wide landscape sheets, so the column is capped at 1100px and
	   the section's own 1240px max-width does the rest. */
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
		box-shadow: 0 30px 70px -28px rgba(239, 60, 92, 0.45);
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
	/* Centred wrap sizes each pill to its own label, which on a 353px column put
	   every one on its own row at a different width — a ragged staircase of eight
	   buttons (266, 201, 196, 226, 225, then Kids+Drinks paired, then 229). A
	   squared grid fixes that: the full menu across the top, the rest in two equal
	   columns. (One full-width column did too, but nine stacked bars was 470px of
	   scrolling past buttons; this is 340.) */
	@media (max-width: 760px) {
		/* `1fr` rows all take the tallest, so the full-menu bar matches the pairs
		   under it instead of standing 12px shorter, and the balanced wrap stops
		   "(PDF)" being left on a line of its own ("Restaurant Week / (PDF)"). Same
		   two lines as Fusion's grid. */
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
		background: var(--ink);
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
		filter: brightness(0.4) saturate(0.9);
	}
	.reserve-bg::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, var(--ink), rgba(10, 9, 8, 0.55) 40%, var(--ink));
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
		font-size: clamp(2.4rem, 5vw, 4rem);
		line-height: 1.08;
		color: var(--ivory);
		margin: 20px auto 18px;
		max-width: 700px;
	}
	.reserve p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 1.02rem;
		line-height: 1.6;
		color: var(--muted);
		max-width: 480px;
		margin: 0 auto 36px;
	}
	/* `.reserve` prefix on purpose: bare `.reserve-note` loses to `.reserve p`
	   above, which handed the note the body size, no top margin (so it sat
	   hard against the button) and a 36px bottom margin (so the band ran deeper
	   below it than above the eyebrow). */
	.reserve .reserve-note {
		margin: 26px auto 0;
		font-size: 0.86rem;
	}
	.reserve-note em {
		font-style: italic;
	}

	/* ===== INFO STRIP ===== */
	.info-strip {
		background: var(--panel);
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
		font-size: 1.2rem;
		color: var(--gold-bright);
		margin: 0 0 22px;
	}
	.info-col p {
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 0.95rem;
		line-height: 1.7;
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

	@media (max-width: 1080px) {
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
		.menu {
			padding: 70px 0;
		}
		.menu-inner,
		.info-grid {
			padding: 0 20px;
		}
		/* The 14ch measure set for the two-column head broke this into four lines
		   of a word or two each. Full width, a touch smaller, it sits on two. */
		.section-head h2 {
			max-width: none;
			font-size: 2rem;
			text-wrap: balance;
		}
		/* A link that breaks across lines ("browse every / menu.") reads as two;
		   where the browser can, keep the last line longer than one word. */
		.section-head .lead {
			text-wrap: pretty;
		}
		/* Phone and email are the two things here people tap — give each a
		   finger's height instead of a 24px line 6px from its neighbour: 11px a
		   side makes a 44px row (8px was 39, still short of a thumb). The address
		   size, so the two fit one line — see below. */
		.info-col .contact-link {
			padding: 11px 0;
			margin: 0;
			font-size: 0.95rem;
		}
		/* A COMPACT strip. The footer straight under this repeats all three blocks
		   (address, contact, every day's hours), so on a phone the strip was 682px
		   — four-fifths of a screen — of scrolling past what the next screen says
		   again. Same words, same order, set tighter: 486px at 390. The number and
		   the email share a line (they fit from 360px up; narrower, they wrap back
		   to two rows), and their own 11px of padding stands in for the gap under
		   "Contact", taken back off the column's foot so it still ends on the text. */
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
	}

	/* ===== SCROLL REVEALS =====
	   One IntersectionObserver sets [data-in] on each [data-reveal] node as it
	   scrolls in; motion is per "kind", tailored to each element's shape.

	   IMPORTANT: these selectors are wrapped in :global(...) (scoped under .page).
	   Svelte's scoped-CSS compiler TREE-SHAKES any selector it can't statically
	   match in the markup — and [data-in] is added at RUNTIME by the observer, so
	   the un-globalled `[data-reveal][data-in]` "settled" rules were being dropped,
	   leaving every element stuck in its off-state. :global() keeps them; pinning
	   them under the scoped `.page` ancestor stops them leaking to other brands /
	   the shared HomeSections (which uses its own `.reveal`, not `data-reveal`). */

	/* rise — title/lede/buttons: fade + lift, honour an optional --rd stagger */
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
	/* words — a headline set word by word, each rising out of its own line mask. */
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
		transform: none;
	}
	/* film — the story film lifts in, unveils from the bottom out of a push-in, and
	   its gold hairline frame draws itself round after it. */
	.page :global([data-reveal='film']) {
		opacity: 0;
		transform: translateY(60px);
		transition:
			opacity 1s ease,
			transform 1.3s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.page :global([data-reveal='film'][data-in]) {
		opacity: 1;
		transform: none;
	}
	.page :global([data-reveal='film'] .dish-frame) {
		clip-path: inset(100% 0 0 0 round 24px);
		transition: clip-path 1.5s cubic-bezier(0.65, 0, 0.35, 1) 0.15s;
	}
	.page :global([data-reveal='film'][data-in] .dish-frame) {
		clip-path: inset(0 round 24px);
	}
	.page :global([data-reveal='film'] .dish-frame video) {
		transform: scale(1.2);
		transition: transform 2.2s cubic-bezier(0.16, 1, 0.3, 1) 0.15s;
	}
	.page :global([data-reveal='film'][data-in] .dish-frame video) {
		transform: none;
	}
	.page :global([data-reveal='film'] .dish-outline) {
		clip-path: inset(0 100% 100% 0 round 24px);
		transition: clip-path 1.6s cubic-bezier(0.65, 0, 0.35, 1) 0.6s;
	}
	.page :global([data-reveal='film'][data-in] .dish-outline) {
		clip-path: inset(0 round 24px);
	}
	.page :global([data-reveal='rise']) {
		opacity: 0;
		transform: translateY(26px);
		transition:
			opacity 0.85s var(--ease-asia) var(--rd, 0s),
			transform 0.85s var(--ease-asia) var(--rd, 0s);
	}
	/* Phones: quicker, shorter, and the stagger squeezed to 40%. A flick lands a
	   section on screen all at once, and at 0.85s + up to 0.2s of stagger the
	   last paragraph was still under 40% ink 300ms after it arrived (and not
	   settled for 600) — a blank screen that then fades in. This has everything
	   past 90% by 300ms. Ahead of the [data-in] rule so that still wins. */
	@media (max-width: 760px) {
		.page :global([data-reveal='rise']) {
			transform: translateY(14px);
			transition:
				opacity 0.45s var(--ease-asia) calc(var(--rd, 0s) * 0.4),
				transform 0.45s var(--ease-asia) calc(var(--rd, 0s) * 0.4);
		}
	}
	.page :global([data-reveal='rise'][data-in]) {
		opacity: 1;
		transform: translateY(0);
	}

	/* accent — the gold diamond rule between two hairlines pops in */
	.page :global([data-reveal='accent']) {
		opacity: 0;
		transform: scale(0.9);
		transition:
			opacity 0.7s var(--ease-asia),
			transform 0.7s var(--ease-asia);
	}
	.page :global([data-reveal='accent'][data-in]) {
		opacity: 1;
		transform: scale(1);
	}

	/* col-l / col-r — the two statement columns slide in from opposite edges */
	.page :global([data-reveal='col-l']) {
		opacity: 0;
		transform: translateX(-34px);
		transition:
			opacity 0.9s var(--ease-asia),
			transform 0.9s var(--ease-asia);
	}
	.page :global([data-reveal='col-r']) {
		opacity: 0;
		transform: translateX(34px);
		transition:
			opacity 0.9s var(--ease-asia) 0.08s,
			transform 0.9s var(--ease-asia) 0.08s;
	}
	.page :global([data-reveal='col-l'][data-in]),
	.page :global([data-reveal='col-r'][data-in]) {
		opacity: 1;
		transform: translateX(0);
	}

	/* pop — the three diamonds scale up with a quick spring-ish stagger */
	.page :global([data-reveal='pop'] span) {
		opacity: 0;
		transform: scale(0) rotate(45deg);
		transition:
			opacity 0.5s var(--ease-asia),
			transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.page :global([data-reveal='pop'][data-in] span) {
		opacity: 0.7;
		transform: scale(1) rotate(45deg);
	}
	.page :global([data-reveal='pop'][data-in] span:nth-child(2)) {
		transition-delay: 0.1s;
	}
	.page :global([data-reveal='pop'][data-in] span:nth-child(3)) {
		transition-delay: 0.2s;
	}

	/* card — menu cards rise + scale-from-0.96, with per-card --rd stagger */
	.page :global([data-reveal='card']) {
		opacity: 0;
		transform: translateY(38px) scale(0.965);
		transition:
			opacity 0.8s var(--ease-asia) var(--rd, 0s),
			transform 0.8s var(--ease-asia) var(--rd, 0s);
	}
	.page :global([data-reveal='card'][data-in]) {
		opacity: 1;
		transform: translateY(0) scale(1);
	}

	/* band — full-bleed image slabs: the photo eases out of an over-zoom so the
	   caption emerges from a slow-pushing-in image */
	.page :global([data-reveal='band'] .band-image),
	.page :global([data-reveal='band'] .room-image) {
		transform: scale(1.18);
		transition: transform 1.6s var(--ease-asia);
	}
	.page :global([data-reveal='band'][data-in] .band-image),
	.page :global([data-reveal='band'][data-in] .room-image) {
		transform: scale(1.04);
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
		.page :global([data-reveal]) {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}
		.page :global([data-reveal='pop'] span) {
			opacity: 0.7 !important;
			transform: rotate(45deg) !important;
		}
		.page :global([data-reveal='band'] .band-image),
		.page :global([data-reveal='band'] .room-image) {
			transform: scale(1.04) !important;
		}
		.page :global([data-reveal] .wi),
		.page :global([data-reveal] .dish-frame video) {
			transform: none !important;
			transition: none !important;
		}
		.page :global([data-reveal='frame']),
		.page :global([data-reveal] .dish-frame),
		.page :global([data-reveal] .dish-outline) {
			clip-path: none !important;
			transition: none !important;
		}
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 820px) {
		/* The hero has its own 600px breakpoint (see the HERO block); everything
		   below here is the rest of the page, which hasn't been redesigned yet. */
		.statement {
			padding: 4.5rem 1.4rem 3.5rem;
		}
		.statement-grid {
			grid-template-columns: 1fr;
			gap: 1.6rem;
		}
		.room {
			height: 56vh;
		}
		.band {
			height: 52vh;
		}
		.band-caption {
			padding: 0 1.6rem 2.6rem;
		}
	}

	@media (max-width: 480px) {
		.statement-lead {
			font-size: 1.4rem;
		}
	}
</style>
