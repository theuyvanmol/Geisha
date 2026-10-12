<script lang="ts">
	// "Keep it Social": a small Instagram feed — a profile bar over five portrait
	// tiles — in the brand's own colours. Shows only the photo or reel itself: no
	// captions, likes or comments.
	//
	// The tiles are the live feed from /api/instagram when there is one (see
	// src/routes/api/instagram/+server.ts; reels then play muted while on screen).
	// Until that endpoint has a token it returns nothing, and the tiles are the
	// hand-picked stand-in posts in $lib/data/social.ts. The swap is automatic and
	// the layout is the same either way.
	import { onMount } from 'svelte';
	import type { Brand } from '$lib/data/brand';
	import type { GalleryImage } from '$lib/data/gallery';
	import { INSTAGRAM_STANDIN } from '$lib/data/social';
	import type { InstagramPost } from '../../routes/api/instagram/+server';

	// `images` is still accepted so existing callers keep working, but the strip
	// no longer falls back to the gallery.
	let { brand }: { brand: Brand; images?: GalleryImage[] } = $props();

	const MAX = 5;
	type Tile = InstagramPost & { alt?: string };
	// Rendered on the server too, so the strip is there on first paint.
	let posts = $state<Tile[]>(INSTAGRAM_STANDIN);
	let strip = $state<HTMLElement>();

	onMount(() => {
		let io: IntersectionObserver | undefined;
		const ctrl = new AbortController();

		fetch('/api/instagram', { signal: ctrl.signal })
			.then((r) => (r.ok ? r.json() : { posts: [] }))
			.then((b: { posts?: InstagramPost[] }) => {
				const live = (b.posts ?? []).slice(0, MAX);
				if (!live.length) return; // no token yet, or an empty feed: keep the stand-ins
				posts = live;
				// Wait for the tiles to render, then play reels only while they're visible.
				requestAnimationFrame(() => {
					const vids = strip?.querySelectorAll('video') ?? [];
					if (!vids.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
					io = new IntersectionObserver((es) =>
						es.forEach((e) => {
							const v = e.target as HTMLVideoElement;
							if (e.isIntersecting) v.play().catch(() => {});
							else v.pause();
						})
					);
					vids.forEach((v) => io!.observe(v));
				});
			})
			.catch(() => {});

		return () => {
			ctrl.abort();
			io?.disconnect();
		};
	});
</script>

<section class="ig" data-brand={brand.id}>
	<header class="head">
		<span class="eyebrow">On Instagram</span>
		<h2>Keep it Social</h2>
	</header>

	<div class="feed">
		<!-- The profile bar: the account's own mark in a ring, its handle, a follow button. -->
		<div class="profile">
			<a class="avatar" href={brand.instagram} target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">
				<img src="/images/brand/geisha-g.webp" alt="" width="394" height="600" />
			</a>
			<div class="who">
				<a class="handle" href={brand.instagram} target="_blank" rel="noopener noreferrer">
					{brand.instagramHandle.replace(/^@/, '')}
				</a>
				<span class="name">Geisha Restaurants</span>
			</div>
			<a class="follow" href={brand.instagram} target="_blank" rel="noopener noreferrer" aria-label="Follow Geisha on Instagram">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<rect x="3" y="3" width="18" height="18" rx="5" />
					<circle cx="12" cy="12" r="4.2" />
					<circle cx="17.3" cy="6.7" r="0.6" class="dot" />
				</svg>
				<span>Follow</span>
			</a>
		</div>

		<div class="strip" bind:this={strip}>
			{#each posts as p, i (p.id)}
				<a
					class="post"
					href={p.href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={p.kind === 'video' ? 'Watch this reel on Instagram' : 'View this post on Instagram'}
					style="--i:{i}"
				>
					{#if p.kind === 'video' && p.video}
						<video src={p.video} poster={p.image} muted loop playsinline preload="none" aria-hidden="true"></video>
					{:else}
						<img src={p.image} alt={p.alt ?? ''} loading="lazy" decoding="async" />
					{/if}
					{#if p.kind === 'video'}
						<span class="reel" aria-hidden="true">
							<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
						</span>
					{/if}
					<span class="view" aria-hidden="true">View on Instagram</span>
				</a>
			{/each}
		</div>
	</div>
</section>

<style>
	.ig {
		max-width: 1200px;
		margin: 0 auto;
		padding: 3rem 1.2rem;
		text-align: center;
	}
	.head {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.8rem;
	}
	.eyebrow {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--accent);
	}
	h2 {
		/* --font-display, not --font-serif: on Fusion this heading was the one
		   Cormorant Garamond island on an otherwise Libre Baskerville page. */
		font-family: var(--font-display);
		font-size: clamp(1.8rem, 4vw, 2.6rem);
		color: var(--ink);
		margin: 0;
		font-weight: 500;
	}

	/* The feed sits on a raised panel with a hairline, like a framed print on the
	   page's ground — the brand tokens give Asia ink and gold, Fusion green and ember. */
	.feed {
		background: var(--bg-2);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: clamp(14px, 2vw, 22px);
		text-align: left;
	}

	.profile {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 2px 2px clamp(14px, 2vw, 20px);
	}
	/* The account's "G" inside a ring that runs from the accent to the second
	   accent — the shape of a story ring, in the house's colours rather than
	   Instagram's. */
	.avatar {
		flex: none;
		box-sizing: border-box;
		width: 54px;
		height: 54px;
		border-radius: 50%;
		padding: 2px;
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		display: block;
		line-height: 0;
	}
	/* Fixed size, not 100%: the logo file is portrait, and a percentage height
	   against the ring's padding box let it stretch the ring into an oval. */
	.avatar img {
		display: block;
		width: 50px;
		height: 50px;
		border-radius: 50%;
		object-fit: contain;
		background: var(--bg);
		border: 2px solid var(--bg-2);
		padding: 9px;
		box-sizing: border-box;
	}
	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-right: auto;
	}
	.handle {
		font-family: var(--font-sans);
		font-size: 0.98rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--ink);
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Every :hover in this block sits behind (hover: hover). On a touch screen a tap
	   leaves :hover switched on, and each of these opens Instagram in a new tab — so
	   the visitor came back to a tile still zoomed with its caption up, or a Follow
	   button still filled in. */
	@media (hover: hover) {
		.handle:hover {
			color: var(--accent);
		}
	}
	.name {
		font-family: var(--font-sans);
		font-size: 0.8rem;
		color: var(--ink-faint);
	}
	.follow {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 9px;
		padding: 10px 18px;
		border: 1px solid var(--accent);
		border-radius: 999px;
		font-family: var(--font-sans);
		font-size: 0.7rem;
		font-weight: 500;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink);
		text-decoration: none;
		transition:
			background-color 0.3s ease,
			color 0.3s ease;
	}
	.follow svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
	}
	.follow svg .dot {
		fill: currentColor;
	}
	.follow:focus-visible {
		background: var(--accent);
		color: var(--bg);
	}
	@media (hover: hover) {
		.follow:hover {
			background: var(--accent);
			color: var(--bg);
		}
	}

	.strip {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 8px;
	}
	/* Portrait tiles: a reel's cover is 9:16, and 4:5 keeps its subject without
	   making the section tall. A square photo from the live feed is cropped to match. */
	.post {
		position: relative;
		aspect-ratio: 4 / 5;
		overflow: hidden;
		border-radius: 5px;
		line-height: 0;
		background: rgba(0, 0, 0, 0.25);
		animation: rise 0.8s cubic-bezier(0.215, 0.61, 0.355, 1) both;
		animation-delay: calc(var(--i) * 70ms);
	}
	.post img,
	.post video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.6s ease;
	}
	.post::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0) 46%);
		opacity: 0;
		transition: opacity 0.35s ease;
		pointer-events: none;
	}
	.view {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 14px;
		z-index: 1;
		text-align: center;
		line-height: 1.3;
		font-family: var(--font-sans);
		font-size: 0.62rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: #fff;
		opacity: 0;
		translate: 0 6px;
		transition:
			opacity 0.35s ease,
			translate 0.35s ease;
	}
	.post:focus-visible::after,
	.post:focus-visible .view {
		opacity: 1;
	}
	.post:focus-visible .view {
		translate: 0 0;
	}
	@media (hover: hover) {
		.post:hover img,
		.post:hover video {
			transform: scale(1.06);
		}
		.post:hover::after,
		.post:hover .view {
			opacity: 1;
		}
		.post:hover .view {
			translate: 0 0;
		}
	}
	.post:focus-visible,
	.follow:focus-visible,
	.handle:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.reel {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 1;
		width: 22px;
		height: 22px;
		color: #fff;
		opacity: 0.9;
		filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
	}
	.reel svg {
		width: 100%;
		height: 100%;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
	}
	/* Narrower than five tiles can sit: the row scrolls sideways and snaps, the way
	   a reels tray does, rather than wrapping into an uneven second row. */
	@media (max-width: 820px) {
		.strip {
			display: flex;
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			scrollbar-width: none;
			/* The row runs out to the panel's edge on BOTH sides. It used to bleed on
			   the right only, so once it had moved the tiles were cut off square at
			   the left padding, 14px short of the border. scroll-padding keeps a
			   snapped tile on the profile row's left edge rather than under the border. */
			margin-inline: calc(clamp(14px, 2vw, 22px) * -1);
			padding-inline: clamp(14px, 2vw, 22px);
			scroll-padding-inline: clamp(14px, 2vw, 22px);
			/* A sideways fling that runs out of tiles stops here, instead of being
			   handed on to the page or the browser's own edge gestures. Sideways only:
			   an up/down swipe that starts on a tile still scrolls the page. */
			overscroll-behavior-x: contain;
		}
		.strip::-webkit-scrollbar {
			display: none;
		}
		.post {
			flex: 0 0 min(42%, 210px);
			scroll-snap-align: start;
		}
	}
	/* Phones: the page's 20px gutter (1.2rem is 19.2px), and a Follow pill a finger
	   tall (it was 36px). */
	@media (max-width: 600px) {
		.ig {
			padding-left: 20px;
			padding-right: 20px;
		}
		.follow {
			box-sizing: border-box;
			min-height: 44px;
		}
	}
	/* Too narrow for the handle and a lettered pill: the pill becomes the glyph in a
	   circle. 44px, a finger's width — on 10px of padding it was a 36px target. */
	@media (max-width: 420px) {
		.follow span {
			display: none;
		}
		.follow {
			box-sizing: border-box;
			width: 44px;
			height: 44px;
			padding: 0;
			justify-content: center;
		}
		.follow svg {
			width: 17px;
			height: 17px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.post {
			animation: none;
		}
		.post img,
		.post video,
		.post::after,
		.view {
			transition: none;
		}
	}
</style>
