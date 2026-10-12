// Client-side hand-off flag for the front door → brand transition.
//
// The landing page raises this immediately before goto(); each brand layout reads
// it at component init to decide whether to open with its arrival animation
// (Asia's shoji panels, Fusion's cover fade) instead of simply appearing.
//
// WHY NOT ?enter=1, WHICH THIS REPLACED
//
// app.html carries data-sveltekit-preload-data="hover", so hovering a tile makes
// SvelteKit preload the link's own href — '/asia'. SvelteKit's preload cache holds
// exactly ONE entry, so that built-in preload evicted our warmed '/asia?enter=1',
// and every click then re-ran the whole load from cold behind the departure
// animation: a second or more of dead cover before anything moved. Two URLs for one
// destination can't share a one-slot cache. Dropping the query means the built-in
// preloader, our own warm-up and the actual navigation are all the same id — they
// cooperate instead of evicting each other.
//
// It also removes a replaceState() that used to run during the most timing-sensitive
// moment of the arrival purely to scrub the flag back out of the address bar.
//
// Lifecycle: set by the landing, read at init by the brand layout AND its home page,
// cleared in the layout's onMount. Svelte mounts children before parents, so by the
// time the layout clears it every reader has already seen it.

let entering = false;

/** Landing page: about to hand off to `brand`. Call immediately before goto(). */
export function markEntering(): void {
	entering = true;
}

/** Destination: did we get here from the front door? Read at component init. */
export function isEntering(): boolean {
	return entering;
}

/** Destination layout: consume the flag once the arrival has been set up. */
export function clearEntering(): void {
	entering = false;
}

// The same idea for intra-Asia navigation. AsiaPageCurtain dips the screen to
// dark, swaps the page behind it and lifts — so the destination has ALREADY been
// covered by the time it mounts. A page that owns an entry curtain (the home
// hero) must not play a second one underneath the lift: that is two opaque
// layers in series, the exact thing the shoji replaced on arrival.
//
// Set immediately before the gated goto(), read at component init by the
// destination, cleared once that navigation has resolved.
let covered = false;

/** AsiaPageCurtain: the screen is dark and about to swap. */
export function markCovered(): void {
	covered = true;
}

/** Destination: did the page dip already cover this arrival? Read at init. */
export function isCovered(): boolean {
	return covered;
}

/** AsiaPageCurtain: the navigation has landed; every reader has seen the flag. */
export function clearCovered(): void {
	covered = false;
}
