// Home-page "Inside" showcase — the Doorway. Built from the Sep 2026 video shoot,
// the Oct 2026 photo drop and older room clips, cut by
// scripts/make-showcase-video.mjs into the films below.
//
// It sits straight under the hero on both home pages: the manager wants the
// premises and the food without scrolling far, and wants the hero artwork kept.
// Four treatments were built for the client to choose from; the Doorway was the
// one picked (Oct 2026) and the other three, with their review page, are gone.
//
// Which material belongs to which house: the mural faces, blossom trees, painted
// lanterns and tropical-print chairs are Geisha Fusion's room; Geisha Asia's are
// the red tomoe lanterns and the neon 欢迎 (welcome) sign. The building exterior
// carries the Geisha Asia sign. Every dish was checked against menus.asia.ts /
// menus.fusion.ts — the photo drop's folders were not reliable on their own.

import type { BrandId } from './brand';
import { mediaAt } from '$lib/media/responsive';

// DISPLAY TYPE. The owner asked for strong typography in the showcase — and for
// it to be the restaurants' own, not borrowed. The faces are the ones embedded in
// their printed menus; see showcase/type.css for which, and for what stands in
// where a face has no web licence. The Doorway loads its house's stylesheet
// itself (<svelte:head>) — where it has one: Asia's face is self-hosted
// (type.css), so only Fusion's stand-in comes from Google Fonts. Nothing sets
// type in Montserrat any more (the treatments that did are gone), so it is no
// longer requested.
export const TYPE_HREF: Partial<Record<BrandId, string>> = {
	fusion: 'https://fonts.googleapis.com/css2?family=Caprasimo&display=swap'
};

export interface Clip {
	src: string;
	poster: string;
	label: string;
}
export interface Food {
	/** A media-manifest key or an R2 URL — both go through imgAttrs(). */
	src: string;
	label: string;
}
export interface Chapter {
	label: string;
	/** seconds into the reel */
	at: number;
}
export interface Reel {
	src: string;
	poster: string;
	duration: number;
	chapters: Chapter[];
}
export interface Showcase {
	title: string;
	lede: string;
	/** The doorway's room while the arch is still closed — a chosen shot, not
	 *  whatever frame the film happens to be on. */
	door: Clip;
	reel: Reel;
	reelPhone: Reel;
	/** The doorway's two framed pictures: things the film does NOT show, so nothing
	 *  repeats beside it. Rooms on both houses since Oct 2026 (the owner's picks). */
	plates: [Food, Food];
}

const v = (slug: string, label = ''): Clip => ({
	src: mediaAt(`/media/showcase-${slug}.mp4`),
	poster: mediaAt(`/media/showcase-${slug}-poster.webp`),
	label
});

/** The chapter the doorway lands on when it opens. */
export const FOOD_CHAPTER = 'The food';

// WEIGHT. What a phone fetches here is cut for a phone: the door clips and the
// portrait reels are 720x1280 (the script's `phone-720` job — the 1080x1920
// originals were 6.3 MB a page between them), and the two framed pictures are
// 600px wide for a slot that is never drawn above 260 CSS px. Uploads to the CDN
// are cached for good, so a re-cut always takes a new version suffix.
//
// Chapter times are where each part's picture starts in the joined reel — the
// "segment starts" make-showcase-video.mjs prints for each JOIN. Re-cut the
// films → copy the new numbers here.
export const SHOWCASE: Record<BrandId, Showcase> = {
	asia: {
		title: 'Under the lanterns',
		lede: 'Lantern-lit rooms under the blossom. Sushi, dim sum and plates made to share.',
		// The arch and both frames are the owner's own photographs (Oct 2026, the
		// script's `asia-doorway` job): the one room, three ways. No dishes, so
		// nothing here needs keeping in step with the menu.
		door: v('asia-door-v3', 'The lanterns'),
		reel: {
			...v('asia-reel-v4'),
			duration: 15.3,
			chapters: [
				{ label: 'Outside', at: 0 },
				{ label: 'The food', at: 4.25 },
				{ label: 'The rooms', at: 10.55 }
			]
		},
		reelPhone: {
			...v('asia-reel-m-v5'),
			duration: 18.7,
			chapters: [
				{ label: 'Outside', at: 0 },
				{ label: 'The food', at: 4.25 },
				{ label: 'The rooms', at: 10.55 }
			]
		},
		plates: [
			{ src: mediaAt('/media/showcase-plate-asia-mural-v1.webp'), label: 'The mural' },
			{ src: mediaAt('/media/showcase-plate-asia-long-table-v1.webp'), label: 'The long table' }
		]
	},
	fusion: {
		title: 'Pull up a chair',
		lede: 'Painted walls, blossom trees and a stone-baked pizza oven. Burgers, pizza and pasta for the whole table.',
		// The arch and both frames are the owner's own picks (Oct 2026, cut by the
		// script's `fusion-doorway` job). His folder was all rooms, so Fusion's two
		// frames show the house, not dishes — nothing to keep in step with the menu.
		door: v('fusion-door-v2', 'The lantern room'),
		reel: {
			...v('fusion-reel-v3'),
			duration: 20.3,
			chapters: [
				{ label: 'The rooms', at: 0 },
				{ label: 'The food', at: 9.25 },
				{ label: 'The kitchen', at: 15.55 }
			]
		},
		reelPhone: {
			...v('fusion-reel-m-v4'),
			duration: 19.6,
			chapters: [
				{ label: 'The rooms', at: 0 },
				{ label: 'The food', at: 8.25 },
				{ label: 'The kitchen', at: 15.85 }
			]
		},
		plates: [
			{ src: mediaAt('/media/showcase-plate-fusion-mural-wall-v2.webp'), label: 'The mural wall' },
			{ src: mediaAt('/media/showcase-plate-fusion-lantern-bar-v2.webp'), label: 'Lanterns and blossom' }
		]
	}
};

// ---------------------------------------------------------------- actions

const reduced = () =>
	typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;

/**
 * Lazy, in-view-only playback for a muted loop. The real source sits in
 * `data-src` (and `data-src-phone` for a portrait cut; such a clip gives its two
 * stills as `data-poster` / `data-poster-phone`), so no video downloads until the
 * clip has actually started to come on screen — `fetchAt` is how far in, as an
 * IntersectionObserver rootMargin. It PLAYS only while some of it is on screen.
 *
 * NOT "within half a screen", as it used to be. The Doorway sits straight under
 * the hero, so it was within half a screen from the moment the page opened, and
 * both of its clips — 6 MB between them on a phone — started downloading with
 * the page, ahead of every picture below them (the owner: "it takes a while for
 * the images to load"). The poster is the clip's own first frame, so waiting
 * until the clip is on screen costs nothing the eye can see.
 * Under reduced motion it loads but never autoplays — the poster stands in.
 */
export function inviewVideo(
	node: HTMLVideoElement,
	opts: { paused?: boolean; fetchAt?: string } = {}
) {
	let paused = !!opts.paused;
	let near = false; // far enough on screen (see fetchAt): fetch it
	let onscreen = false; // in the viewport: play it
	node.muted = true;
	node.playsInline = true;
	// A clip with two cuts names its stills in data- attributes instead of `poster`,
	// so a phone fetches the portrait one only — not the wide one first.
	const still = (isPhone() && node.dataset.posterPhone) || node.dataset.poster;
	if (still) node.poster = still;
	// `data-src` may be absent at first (a clip the component hasn't armed yet):
	// nothing is fetched until it appears, and it is picked up on the next update.
	const load = () => {
		if (node.getAttribute('src')) return;
		const phone = node.dataset.srcPhone;
		const src = phone && isPhone() ? phone : node.dataset.src;
		if (!src) return;
		// the markup says preload="none" so nothing is fetched before this point;
		// from here it should buffer, so it is ready by the time it scrolls in
		node.preload = 'auto';
		node.src = src;
	};
	const sync = () => {
		if (near) load();
		if (onscreen && !paused && !reduced() && node.getAttribute('src')) node.play().catch(() => {});
		else node.pause();
	};
	const ahead = new IntersectionObserver(
		([e]) => {
			// Once fetched it stays fetched — `near` only ever needs to turn true.
			if (e.isIntersecting) near = true;
			sync();
		},
		// Negative: the clip must be this far INSIDE the screen, not merely touching
		// its edge (which a section starting exactly at the fold does at scroll 0).
		{ rootMargin: opts.fetchAt ?? '-6% 0px' }
	);
	const inview = new IntersectionObserver(([e]) => {
		onscreen = e.isIntersecting;
		sync();
	});
	ahead.observe(node);
	inview.observe(node);
	return {
		update(o: { paused?: boolean; fetchAt?: string } = {}) {
			paused = !!o.paused;
			// after the DOM has caught up, so a data-src set in the same tick is seen
			queueMicrotask(sync);
		},
		destroy() {
			ahead.disconnect();
			inview.disconnect();
		}
	};
}

/**
 * Scroll progress of a section, 0→1, handed to `onprogress` once per frame.
 *
 *   'pin'      0 when the section's top meets the viewport top, 1 when its sticky
 *              stage (its first child) lets go at the section's end — for a tall
 *              section with a sticky stage.
 *   'through'  0 when its top enters at the bottom of the screen, 1 when its
 *              bottom leaves at the top — for parallax.
 *
 * Reads the rect in a rAF after each scroll, so it follows Lenis' smoothed
 * position as well as native scrolling.
 */
export function scrollProgress(
	node: HTMLElement,
	opts: { mode: 'pin' | 'through'; onprogress: (p: number) => void }
) {
	let raf = 0;
	const measure = () => {
		raf = 0;
		const r = node.getBoundingClientRect();
		const vh = window.innerHeight;
		// A pin's travel is the section's height less its STAGE's — not less the
		// window's. They are the same on a desktop; on a phone innerHeight changes
		// every time the browser's toolbars slide in or out (reverse direction
		// mid-pin and they do), and the progress would jump by a tenth with it.
		const stage = opts.mode === 'pin' ? (node.firstElementChild as HTMLElement | null) : null;
		const p =
			opts.mode === 'pin'
				? -r.top / Math.max(1, r.height - (stage?.offsetHeight || vh))
				: (vh - r.top) / (vh + r.height);
		opts.onprogress(Math.min(1, Math.max(0, p)));
	};
	// Only while the section is on or near the screen: the page is many screens
	// long, and off screen there is nothing to follow. The observer takes a reading
	// of its own each time the section comes into range or leaves it — the leaving
	// one clamps to 0 or 1, so a section flicked past still ends in the right state.
	let live = false;
	const queue = () => {
		if (live && !raf) raf = requestAnimationFrame(measure);
	};
	const io = new IntersectionObserver(
		([e]) => {
			live = e.isIntersecting;
			if (!raf) raf = requestAnimationFrame(measure);
		},
		{ rootMargin: '50% 0px' }
	);
	io.observe(node);
	measure();
	window.addEventListener('scroll', queue, { passive: true });
	window.addEventListener('resize', queue);
	return {
		update(o: typeof opts) {
			opts = o;
			if (!raf) raf = requestAnimationFrame(measure);
		},
		destroy() {
			io.disconnect();
			cancelAnimationFrame(raf);
			window.removeEventListener('scroll', queue);
			window.removeEventListener('resize', queue);
		}
	};
}

/** 0→1 over [a,b] of p, eased (smoothstep). */
export function span(p: number, a: number, b: number) {
	const x = Math.min(1, Math.max(0, (p - a) / (b - a)));
	return x * x * (3 - 2 * x);
}
