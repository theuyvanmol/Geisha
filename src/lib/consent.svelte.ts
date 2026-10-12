// Cookie consent for the public site.
//
// WHAT THIS SITE ACTUALLY SETS
// ----------------------------
// The pages set no cookies of their own. Two third parties can, and both are
// behind this gate:
//
//   * Google Tag Manager and the Meta (Facebook) Pixel — carried over from the
//     old WordPress site, loaded by $lib/components/Analytics.svelte.
//
// The booking page is NOT behind it any more (Oct 2026): it mounts our own form,
// which is first-party and sets nothing. Stripe's script loads only when a
// booking needs a card, after the guest has asked to pay — strictly necessary,
// so it needs no consent. (The privacy page says so.)
//
// WHY GATE THEM
// -------------
// Analytics and advertising cookies need consent outright. The old ResDiary
// widget was gated too — it is still in the tree as the fallback engine, and if
// it is ever switched back on it keeps its gate (`embedsAllowed`): that widget is
// configured inside the client's ResDiary account, not here, and that config can
// carry its own tag manager and pixel firing on booking completion. We can't see
// or control that from this repo, so that frame waits for the guest's agreement.
//
// The choice lives in localStorage, NOT a cookie — recording a cookie decision
// shouldn't itself set a cookie.
//
// Bump STORAGE_KEY's version suffix to re-ask everyone. v2 did exactly that:
// v1's banner told guests the site set no cookies of its own, which no longer
// covers GTM and the Pixel, so consent given under it can't carry over.

const STORAGE_KEY = 'geisha:cookie-consent:v2';

export type ConsentChoice = 'accepted' | 'rejected';

let choice = $state<ConsentChoice | null>(null);
/** Has localStorage been read yet? Guards a banner flash before hydration. */
let ready = $state(false);
let promptOpen = $state(false);
/**
 * "Show me the booking form just this once" — lets a guest who declined still
 * book without having to change their mind permanently. Deliberately NOT
 * persisted: it dies with the page.
 */
let allowOnce = $state(false);

function read(): ConsentChoice | null {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored === 'accepted' || stored === 'rejected' ? stored : null;
	} catch {
		// Private mode / storage blocked. Treat as undecided; we just re-ask.
		return null;
	}
}

/** Read the stored decision. Call once, client-side, from the banner's onMount. */
export function initConsent(): void {
	choice = read();
	ready = true;
	promptOpen = choice === null;
}

export function setConsent(next: ConsentChoice): void {
	choice = next;
	promptOpen = false;
	if (next === 'accepted') allowOnce = false;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// Nothing to do — the in-memory choice still applies for this visit.
	}
}

/** Re-open the banner so a guest can change their mind (footer link). */
export function openConsentPrompt(): void {
	promptOpen = true;
}

/** Load the booking widget for this page view only, without granting consent. */
export function allowEmbedsOnce(): void {
	allowOnce = true;
}

export const consent = {
	get ready() {
		return ready;
	},
	get choice() {
		return choice;
	},
	get decided() {
		return choice !== null;
	},
	get accepted() {
		return choice === 'accepted';
	},
	get promptOpen() {
		return promptOpen;
	},
	/** May we mount a third-party iframe right now? */
	get embedsAllowed() {
		return choice === 'accepted' || allowOnce;
	}
};
