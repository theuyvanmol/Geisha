<script lang="ts">
	// Consent banner for the public site. Mounted once in the root layout.
	//
	// Accept and Reject are deliberately identical in weight — the ICO is explicit
	// that refusing must be as easy as agreeing, so no ghost-button "Reject".
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { consent, initConsent, setConsent } from '$lib/consent.svelte';

	onMount(initConsent);

	// Publish the banner's height as `--cb-h` on <html>.
	//
	// The landing splitter is a fixed, full-viewport stage holding two 50% tiles.
	// A bottom-fixed banner therefore lands squarely on the LOWER tile: at 393x852
	// the banner ran 248px tall and buried the whole Fusion block — eyebrow, hours
	// and the "Enter Geisha Fusion" button — so half the business was invisible and
	// untappable until you dealt with the banner. Anything that needs to keep clear
	// of it can now subtract this value; it reads 0px once the banner is gone.
	//
	// NOT ON A PHONE (owner, Oct 2026: "the cookies banner pushes everything up
	// and is too big"). There the banner is a slim strip — see the phone styles —
	// that fits inside the empty foot every first screen already leaves under its
	// buttons, so nothing has to move for it: `--cb-h` stays unset and the heroes,
	// the landing tiles and the rest lay out exactly as they do once it is gone.
	// The one thing that still has to know is the assistant button, which sits in
	// the corner the strip covers; it reads `--cb-park` and waits off screen.
	function measure(node: HTMLElement) {
		const root = document.documentElement;
		const slim = window.matchMedia('(max-width: 560px)');
		const write = () => {
			const h = `${Math.ceil(node.offsetHeight)}px`;
			root.style.setProperty('--cb-park', h);
			if (slim.matches) root.style.removeProperty('--cb-h');
			else root.style.setProperty('--cb-h', h);
		};
		write();
		const ro = new ResizeObserver(write);
		ro.observe(node);
		slim.addEventListener('change', write);
		return {
			destroy() {
				ro.disconnect();
				slim.removeEventListener('change', write);
				root.style.removeProperty('--cb-h');
				root.style.removeProperty('--cb-park');
			}
		};
	}

	// The privacy page is per-brand; pick the one matching the route the guest is
	// on, defaulting to Asia off the brand subtrees (e.g. the landing splitter).
	const privacyHref = $derived(
		$page.url.pathname.startsWith('/fusion') ? '/fusion/privacy' : '/asia/privacy'
	);
</script>

{#if consent.ready && consent.promptOpen}
	<div
		class="cb"
		use:measure
		role="dialog"
		aria-modal="false"
		aria-labelledby="cb-title"
		aria-describedby="cb-body"
	>
		<div class="cb-inner">
			<div class="cb-text">
				<h2 id="cb-title">Cookies</h2>
				<p id="cb-body" class="cb-full">
					This site sets no cookies of its own. If you agree, we'll load Google Analytics and the
					Meta pixel so we can see how the site is used. Both may set cookies of theirs. Neither
					loads until you agree. See our
					<a href={privacyHref}>Privacy &amp; Cookie Policy</a>.
				</p>
				<!-- The phone's version of the same notice: what loads, on what condition,
				     and where the detail is. The full paragraph above stays in the DOM as the
				     dialog's description, so a screen reader still gets every word. -->
				<p class="cb-short">
					Analytics cookies from Google and Meta, only if you accept.
					<a href={privacyHref}>Cookie policy</a>
				</p>
			</div>
			<div class="cb-actions">
				<button type="button" onclick={() => setConsent('rejected')}>Reject</button>
				<button type="button" onclick={() => setConsent('accepted')}>Accept</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.cb {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 10000;
		background: #14110f;
		color: #f2ece4;
		border-top: 1px solid rgba(242, 236, 228, 0.18);
		box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.45);
		padding: 1.1rem 1.25rem calc(1.1rem + env(safe-area-inset-bottom, 0px));
		/* Its own faces, named outright. The banner is mounted in the ROOT layout,
		   outside every `[data-brand]` wrapper, so the brand font tokens never reach
		   it and it used to inherit whatever `body` happened to carry — which is set
		   by whichever route's CSS chunk loaded last. The result was Cormorant on
		   /asia and a Georgia fallback on /fusion (which never loads Cormorant): the
		   same notice in two different typefaces. Shippori Mincho + Jost are the one
		   pair the landing and BOTH brand layouts always load. */
		font-family: 'Jost', system-ui, -apple-system, 'Segoe UI', sans-serif;
	}

	.cb-inner {
		max-width: 1080px;
		margin: 0 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 2rem;
	}

	.cb-text {
		flex: 1 1 22rem;
	}

	h2 {
		font-family: 'Shippori Mincho', Georgia, 'Times New Roman', serif;
		font-size: 1.15rem;
		font-weight: 400;
		margin: 0 0 0.3rem;
		letter-spacing: 0.02em;
	}

	p {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.55;
		opacity: 0.85;
	}

	a {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.cb-actions {
		display: flex;
		gap: 0.6rem;
		flex: 0 0 auto;
	}

	/* Equal visual weight, on purpose — see the note at the top of this file. */
	.cb-actions button {
		font: inherit;
		font-size: 0.82rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		padding: 0.7rem 1.5rem;
		cursor: pointer;
		background: transparent;
		color: #f2ece4;
		border: 1px solid rgba(242, 236, 228, 0.55);
		border-radius: 2px;
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease;
	}

	.cb-actions button:hover {
		background: rgba(242, 236, 228, 0.12);
		border-color: #f2ece4;
	}

	.cb-actions button:focus-visible {
		outline: 2px solid #f2ece4;
		outline-offset: 2px;
	}

	/* Shown only on a phone — see below. */
	.cb-short {
		display: none;
	}

	/* PHONES: A SLIM STRIP, NOT A PANEL.
	   The full notice stood 172px tall on a phone (248px before that) — a fifth to a
	   third of the first screen — and because it covered the hero's buttons, every
	   first screen had been taught to climb out of its way and settle back when it
	   went. The owner's verdict: too big, and it pushes everything up.
	   So on a phone it is one row: a two-line notice beside the two buttons, about
	   56px tall. That fits in the empty foot each first screen already keeps under
	   its buttons (92px on the home heroes, 61px on the landing tiles), so nothing
	   needs to move — and CookieBanner no longer publishes `--cb-h` here to make it.
	   Accept and Reject stay the same size and weight as each other. */
	@media (max-width: 560px) {
		.cb {
			padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
			box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
		}
		.cb-inner {
			flex-wrap: nowrap;
			gap: 10px;
		}
		.cb-text {
			flex: 1 1 auto;
			min-width: 0;
		}
		/* Still the dialog's name and description for a screen reader. */
		h2,
		.cb-full {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			padding: 0;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.cb-short {
			display: block;
			font-size: 0.72rem;
			line-height: 1.3;
			opacity: 0.9;
			text-wrap: balance;
		}
		.cb-short a {
			white-space: nowrap;
		}
		.cb-actions {
			gap: 6px;
		}
		.cb-actions button {
			position: relative;
			min-height: 40px;
			padding: 0 10px;
			font-size: 0.69rem;
			letter-spacing: 0.12em;
		}
		/* 40px to the eye, 48px to the thumb. */
		.cb-actions button::after {
			content: '';
			position: absolute;
			inset: -4px -1px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cb-actions button {
			transition: none;
		}
	}
</style>
