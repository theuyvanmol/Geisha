<script lang="ts">
	// Hanging vines for Fusion — the counterpart to Asia's <SakuraPetals>.
	//
	// Strands drop from the top of the page and sway, echoing the painted hanging
	// blossom in the hero artwork. Each is a tapering stem with paired leaflets
	// branching off it, densest at the top and thinning to a fine tip.
	//
	// The clump is TWO-TONE — some strands crimson, some green — because the hero
	// painting is: the artwork has green and teal streaked through the red. An
	// all-crimson clump sat on top of that picture instead of growing out of it.
	//
	// WHY THEY'RE NOT RANDOM AT RUNTIME: this renders on the server too, and
	// Math.random() would produce different geometry on the server and the client,
	// so hydration would throw a mismatch and re-render the lot. A tiny seeded
	// generator gives the same "random" arrangement in both places, every time.
	//
	// Pure SVG + CSS: the sway is a transform animation on each vine's own group,
	// so it stays on the compositor and costs no script after first paint. Nothing
	// animates at all under prefers-reduced-motion.
	//
	// ...and nothing animates once the clump has scrolled away. "Costs no script" is
	// not "costs nothing": the vines hang off the top of a fifteen-screen page and
	// fifteen infinite animations kept ticking for all of it. Measured at the FOOT of
	// the Fusion home page (phone, 4x CPU throttle), pausing them took the style
	// work forced at the start of every scroll frame from 2.4ms to 1.0ms and the
	// average frame from 10.1ms to 7.7ms — a quarter of every frame, spent on
	// something twelve screens out of sight. So an observer puts them to sleep.
	import { onMount } from 'svelte';

	let root: HTMLDivElement;
	let asleep = $state(false);

	onMount(() => {
		// The margin wakes them a little before any strand is back on screen, so the
		// sway is already moving when it comes into view on the way back up.
		const io = new IntersectionObserver(([e]) => (asleep = !e.isIntersecting), {
			rootMargin: '200px 0px'
		});
		io.observe(root);
		return () => io.disconnect();
	});

	/** Deterministic LCG — same sequence on server and client. */
	function makeRandom(seed: number) {
		let s = seed;
		return () => {
			s = (s * 1664525 + 1013904223) % 4294967296;
			return s / 4294967296;
		};
	}

	type Leaf = { x: number; y: number; len: number; side: -1 | 1; droop: number };
	type Vine = {
		/** Offset in px from the patch's left edge — they hang as ONE clump. */
		offset: number;
		/** Overall length in px — the "random length" that makes the clump uneven. */
		len: number;
		/** The stem's cubic control points, as x offsets at 1/3, 2/3 and the tip. */
		c1: number;
		c2: number;
		tip: number;
		leaves: Leaf[];
		/** Sway timing, per vine, so they never move in lockstep. */
		dur: number;
		delay: number;
		sway: number;
		opacity: number;
		width: number;
		/** Gradient ends — each strand is its own shade, not one shared red. */
		from: string;
		mid: string;
		to: string;
	};

	const rand = makeRandom(20260731);

	/** One strand's colour ramp, dark at the anchor and burning brighter toward the
	    tip. Real hanging growth is never a single flat colour — some strands are
	    almost maroon, others reach pink or coral; the green ones run from deep
	    forest out to chartreuse. */
	type Ramp = [string, string, string];

	const RED_RAMPS: Ramp[] = [
		['#4f0a18', '#a8172f', '#e8455e'],
		['#6d0f1e', '#c81e3a', '#ff7a94'],
		['#7a1030', '#d42a55', '#ff9db2'],
		['#5c1410', '#b8341f', '#e8763a'],
		['#3f0c14', '#8f1428', '#c81e3a'],
		['#701a2e', '#e03a52', '#ffb3c2']
	];

	/** The greens are pulled from the hero artwork's own painted streaks — the
	    foliage and the teal of the eyes — so the clump reads as growing out of the
	    picture rather than laid on top of it. */
	const GREEN_RAMPS: Ramp[] = [
		['#0d2b16', '#1f6b32', '#4fae52'],
		['#12331c', '#2d7d3a', '#7fc45f'],
		['#0a2a22', '#1c6b4d', '#4fbf87'],
		['#183218', '#3d8a2e', '#9ccf5a'],
		['#0f2e26', '#227a5c', '#5fd0a0']
	];

	/** WHICH strands are green, as a repeating pattern down the clump.
	    Deliberately NOT a coin flip per strand: the vines are laid out left to right
	    by index, so a random pick happily stacks every green down one side and every
	    red down the other. Tiling a fixed pattern guarantees the two colours
	    interleave across the patch however many strands there are. */
	const GREEN_PATTERN = [false, true, false, true, true, false, false, true, false, true, false];
	const isGreen = (i: number) => GREEN_PATTERN[i % GREEN_PATTERN.length];

	/** A point on the stem's cubic, so leaflets sit ON the curve, not beside it. */
	function bezier(p0: number, p1: number, p2: number, p3: number, t: number) {
		const u = 1 - t;
		return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
	}

	/** Strands in ONE patch — a clump of hanging growth, not a fringe across the
	    whole page. */
	const COUNT = 15;
	/** How wide the patch is, in px. Kept tight so the strands overlap and read as
	    a single mass; widened only in step with COUNT, since packing more strands
	    into the original 200 turned the clump into a solid block. */
	const PATCH = 240;

	const VINES: Vine[] = Array.from({ length: COUNT }, (_, i) => {
		// Even bands INSIDE the patch, jittered — pure random leaves gaps and pairs.
		const band = PATCH / COUNT;
		const offset = i * band + band * (rand() * 0.9);
		const len = 155 + rand() * 400;

		// A sinuous stem, not a stick: the two control points push to OPPOSITE sides
		// so the curve reverses partway down, and the tip trails further still.
		const dir = rand() < 0.5 ? -1 : 1;
		const c1 = dir * (6 + rand() * 16);
		const c2 = -dir * (6 + rand() * 18);
		const tip = dir * (4 + rand() * 22) * -1;

		const leaves: Leaf[] = [];
		// Leaflets every ~5px of arc, alternating sides. The spacing decides whether
		// these read as a feathery frond or a bare twig.
		const steps = Math.floor(len / 5);
		for (let n = 1; n < steps; n++) {
			const t = n / steps; // 0 at the top, 1 at the tip
			leaves.push({
				x: bezier(0, c1, c2, tip, t),
				y: len * t,
				// Full length for most of the drop, closing to a point at the tip; the
				// first few ramp up so the top isn't a blunt end.
				len: (8.4 + rand() * 5.4) * (1 - t * 0.72) * (t < 0.1 ? t / 0.1 : 1),
				side: n % 2 === 0 ? -1 : 1,
				// How far each leaflet hangs rather than sticking straight out. Varying
				// it per leaf is what stops the frond looking like a fishbone.
				droop: 0.55 + rand() * 0.9
			});
		}

		// Exactly ONE rand() call here, as before: the generator is a seeded sequence
		// shared with the geometry above, so drawing an extra number would reshuffle
		// every strand's shape as a side effect of a colour change.
		const palette = isGreen(i) ? GREEN_RAMPS : RED_RAMPS;
		// Rotating by `i` on top of the draw decorrelates the picks. Straight
		// `rand() * length` happily dealt the same ramp to three of the five green
		// strands, which read as one repeated vine rather than a mixed clump.
		const ramp = palette[(Math.floor(rand() * palette.length) + i) % palette.length];
		return {
			offset,
			len,
			c1,
			c2,
			tip,
			leaves,
			dur: 7 + rand() * 6,
			delay: -rand() * 8,
			sway: 1.6 + rand() * 2.2,
			opacity: 0.5 + rand() * 0.38,
			width: 1.25 + rand() * 0.6,
			from: ramp[0],
			mid: ramp[1],
			to: ramp[2]
		};
	});

	/** The tallest strand decides how far down the wrapper has to reach. */
	const maxLen = Math.max(...VINES.map((v) => v.len)) + 30;
</script>

<div class="vines" class:asleep bind:this={root} style="height:{maxLen}px" aria-hidden="true">
	<!-- Width comes from the PATCH constant, not the stylesheet: the two were
	     separate copies of 200 and would silently disagree the moment one changed. -->
	<div class="patch" style="width:{PATCH}px">
		{#each VINES as v, i}
			<div
				class="vine"
				style="left:{v.offset}px; --dur:{v.dur}s; --delay:{v.delay}s; --sway:{v.sway}deg; opacity:{v.opacity}"
			>
				<!-- 96 wide, centred on the stem's anchor. The box has to clear the stem's
				     own sideways wander (up to ~22) PLUS a leaflet's reach off it — at the
				     larger leaflet size that totals ~33, which the old 80 (±40) only just
				     survived and would have clipped on the widest strands. -->
				<svg width="96" height={v.len} viewBox="-48 0 96 {v.len}" fill="none">
					<!-- The stem: a CUBIC with its two control points on opposite sides, so
					     the curve reverses partway down and the strand hangs with a bend in
					     it. A quadratic (one control point) only ever bows one way, which is
					     what made these read as sticks. -->
					<path
						d="M0 0 C {v.c1.toFixed(2)} {(v.len * 0.34).toFixed(1)},
						     {v.c2.toFixed(2)} {(v.len * 0.7).toFixed(1)},
						     {v.tip.toFixed(2)} {v.len}"
						stroke="url(#vine-grad-{i})"
						stroke-width={v.width}
						stroke-linecap="round"
					/>
					{#each v.leaves as leaf}
						<!-- Each leaflet starts at its point ON the stem curve and sweeps out
						     and DOWN, by a per-leaf droop — a fixed angle gives a fishbone. -->
						<path
							d="M {leaf.x.toFixed(2)} {leaf.y.toFixed(1)}
							   q {(leaf.side * leaf.len * 0.62).toFixed(2)} {(leaf.len * 0.12).toFixed(2)}
							     {(leaf.side * leaf.len * 0.82).toFixed(2)} {(leaf.len * leaf.droop).toFixed(2)}"
							stroke="url(#vine-grad-{i})"
							stroke-width={Math.max(0.6, v.width * 0.78)}
							stroke-linecap="round"
						/>
					{/each}
					<defs>
						<linearGradient id="vine-grad-{i}" x1="0" y1="0" x2="0" y2={v.len}>
							<stop offset="0%" stop-color={v.from} />
							<stop offset="45%" stop-color={v.mid} />
							<stop offset="100%" stop-color={v.to} />
						</linearGradient>
					</defs>
				</svg>
			</div>
		{/each}
	</div>
</div>

<style>
	/* Absolutely positioned at the TOP OF THE DOCUMENT (no positioned ancestor, so
	   it resolves against the initial containing block) — which means the vines
	   scroll away with the page instead of hanging over it forever.

	   z-index 1 is chosen precisely: `.hero-bg` on the home page carries
	   `z-index: 0`, so it and everything inside it (the artwork, the scrim, the
	   glow, the rings) is capped below this; `.hero-inner` carries `z-index: 2`,
	   so the headline still sits in front. The vines therefore hang over the
	   picture and behind the type. */
	.vines {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		z-index: 1;
		overflow: hidden;
		pointer-events: none;
	}
	/* ONE clump, anchored near the left edge, rather than strands spread across the
	   whole width. Hanging blossom grows in a mass off a single point; spacing it
	   evenly across the page read as decoration applied to the page instead of
	   something growing into it. */
	.patch {
		position: absolute;
		top: 0;
		left: clamp(12px, 5vw, 110px);
		/* width is set inline from the PATCH constant */
	}
	.vine {
		position: absolute;
		top: 0;
		/* Pivot at the very top, where the stem is anchored — swaying about the
		   centre would make them look like pendulums rather than hanging growth. */
		transform-origin: 50% 0;
		animation: vine-sway var(--dur) ease-in-out var(--delay) infinite alternate;
		will-change: transform;
	}
	.vine svg {
		display: block;
	}
	/* Scrolled out of sight (see the observer in the script): hold each strand
	   where it is and hand its compositor layer back. Paused, not removed, so the
	   sway picks up from the same pose instead of snapping to the first keyframe. */
	.vines.asleep .vine {
		animation-play-state: paused;
		will-change: auto;
	}

	/* A gentle arc either side of rest. The two halves are deliberately uneven so
	   the motion reads as wind rather than a metronome. */
	@keyframes vine-sway {
		0% {
			transform: rotate(calc(var(--sway) * -0.7));
		}
		100% {
			transform: rotate(var(--sway));
		}
	}

	/* Narrower clump on a phone — a 200px patch is a fifth of a desktop viewport
	   but half of a portrait one. Scaling from the top-left keeps it anchored to
	   the same corner rather than sliding inward. */
	@media (max-width: 760px) {
		.patch {
			transform: scale(0.66);
			transform-origin: 0 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.vine {
			animation: none;
			transform: none;
		}
	}
</style>
