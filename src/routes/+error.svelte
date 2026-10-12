<script lang="ts">
	// Branded error page. Without this SvelteKit falls back to its unstyled
	// default, which rendered black #000 text on the app's near-black ground
	// (1.05:1 contrast), carried no links at all and left <title> empty — so any
	// stale link, old QR code or typo landed on what looked like a crashed tab.
	//
	// The site has two restaurants, so we read the brand out of the URL and dress
	// the page in that brand's palette. Unknown paths (e.g. /nope) get the neutral
	// Asia-dark ground the root layout already paints, and offer both restaurants.
	import { page } from '$app/state';
	import { BRANDS } from '$lib/data/brand';

	const brandId = $derived(
		page.url.pathname.startsWith('/fusion')
			? 'fusion'
			: page.url.pathname.startsWith('/asia')
				? 'asia'
				: null
	);
	const brand = $derived(brandId ? BRANDS[brandId] : null);

	const status = $derived(page.status ?? 500);
	const notFound = $derived(status === 404);

	// Staff screens get the server's own words and a way to retry, not the guest copy
	// and guest links. It matters most for the 503 the auth guard sends during a
	// database outage (hooks.server.ts), whose whole point is to tell staff they are
	// still signed in — hiding that message is how an outage passes for a sign-out.
	const isAdmin = $derived(
		page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/')
	);

	const heading = $derived(
		isAdmin && status === 503
			? 'Can’t reach the booking system'
			: notFound
				? 'We can’t find that page'
				: 'Something went wrong'
	);
	const blurb = $derived(
		isAdmin && page.error?.message
			? page.error.message
			: notFound
				? 'The link may be out of date, or the address slightly mistyped. Everything below still works.'
				: 'Sorry — that didn’t load. Please try again, or use a link below.'
	);
	const title = $derived(
		`${notFound ? 'Page not found' : 'Error'} · ${brand ? brand.name : 'Geisha Restaurants'}`
	);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="robots" content="noindex" />
	<!-- An unmatched URL renders under the ROOT layout only, so neither brand layout
	     is there to load the faces the tokens name. Without this the page a stale
	     link lands on is set in Georgia and the system sans. -->
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500&family=Jost:wght@300;400;500&family=Space+Grotesk:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="err brand-page" data-brand={brandId ?? 'asia'}>
	<div class="inner">
		<p class="code">{status}</p>
		<h1>{heading}</h1>
		<p class="blurb">{blurb}</p>

		{#if isAdmin}
			<!-- A full reload, so the retry really goes back to the server. -->
			<nav class="links" aria-label="Recovery">
				<a class="primary" href={page.url.pathname + page.url.search} data-sveltekit-reload
					>Try again</a
				>
			</nav>
		{:else if brand}
			<!-- Stay inside the restaurant the visitor was already in. -->
			<nav class="links" aria-label="Useful links">
				<a class="primary" href="/{brand.id}">{brand.name} home</a>
				<a href="/{brand.id}/menus">Menus</a>
				<a href="/{brand.id}/bookings">Book a table</a>
				<a href="/{brand.id}/contact">Contact</a>
			</nav>
			<p class="alt">
				<a href="/">Both restaurants</a>
				<span aria-hidden="true">·</span>
				<a href="/{brand.id === 'asia' ? 'fusion' : 'asia'}"
					>{brand.id === 'asia' ? 'Geisha Fusion' : 'Geisha Asia'}</a
				>
			</p>
			<p class="call">
				Or call us on <a href="tel:{brand.phone.replace(/\s/g, '')}">{brand.phone}</a>.
			</p>
		{:else}
			<!-- No brand in the URL: offer the chooser and both restaurants. -->
			<nav class="links" aria-label="Useful links">
				<a class="primary" href="/">Choose a restaurant</a>
				<a href="/asia">Geisha Asia</a>
				<a href="/fusion">Geisha Fusion</a>
			</nav>
			<!-- Two parts round a separator, so a phone can stack them (one number per
			     line) instead of breaking the second number across the wrap. -->
			<p class="call">
				<span class="call-part">Or call Asia on <a href="tel:01916071100">0191 607 1100</a></span>
				<span class="call-sep" aria-hidden="true">·</span>
				<span class="call-part">Fusion on <a href="tel:01913004641">0191 300 4641</a>.</span>
			</p>
		{/if}
	</div>
</main>

<style>
	.err {
		display: flex;
		align-items: center;
		justify-content: center;
		/* border-box, or the padding is added to the full-height box and a page with
		   nothing below the fold scrolls. svh so iOS centres it in what is visible. */
		box-sizing: border-box;
		min-height: 100vh;
		min-height: 100svh;
		padding: 4rem 1.4rem;
		text-align: center;
	}
	.inner {
		max-width: 46rem;
	}
	.code {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.4em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0 0 1.2rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.4rem);
		font-weight: 500;
		line-height: 1.12;
		margin: 0 0 1rem;
		color: var(--ink);
		/* Never "We can’t find that / page". */
		text-wrap: balance;
	}
	.blurb {
		font-family: var(--font-body);
		font-size: 1.1rem;
		line-height: 1.6;
		color: var(--ink-soft);
		margin: 0 auto 2.4rem;
		max-width: 34rem;
		/* Two even lines. `pretty` only guards against a one-word last line, and now
		   that Jost actually loads here the break fell after "Everything", leaving
		   "below still works." on its own (and "still works." at 360px). */
		text-wrap: balance;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.8rem 1.4rem;
		margin-bottom: 1.8rem;
	}
	.links a {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--ink-soft);
		text-decoration: none;
		/* 44px minimum touch target */
		padding: 0.85rem 0.4rem;
		transition: color 0.25s ease;
	}
	.links a:hover,
	.links a:focus-visible {
		color: var(--accent);
	}
	.links a.primary {
		color: var(--bg);
		background: var(--accent);
		padding: 0.9rem 1.6rem;
	}
	.links a.primary:hover,
	.links a.primary:focus-visible {
		background: var(--accent-2, var(--accent));
		color: var(--bg);
	}
	.alt,
	.call {
		font-family: var(--font-body);
		font-size: 0.98rem;
		color: var(--ink-faint);
		margin: 0 0 0.6rem;
	}
	.alt span {
		margin: 0 0.5rem;
		opacity: 0.5;
	}
	.alt a,
	.call a {
		color: var(--accent);
		text-decoration: none;
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.alt a:hover,
	.call a:hover {
		border-bottom-color: var(--accent);
	}
	/* A phone number is one word. */
	.call a {
		white-space: nowrap;
	}
	:where(.err) a:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}

	/* PHONE */
	@media (max-width: 640px) {
		/* The cookie notice is fixed to the bottom and a stale link is often a first
		   visit, so centre in the space above it (CookieBanner publishes `--cb-h`;
		   unset once dismissed) and let the rest scroll clear. */
		.err {
			padding-top: 2.5rem;
			padding-bottom: calc(2.5rem + var(--cb-h, 0px));
		}
		.code {
			font-size: 0.75rem;
		}
		.blurb {
			font-size: 1.05rem;
			margin-bottom: 2rem;
		}
		/* The wrap used to fall wherever it fell — button + one link, then two more.
		   Give the primary action its own full row and the rest sit as one line. */
		.links {
			gap: 0.3rem 1.2rem;
			margin-bottom: 1.3rem;
		}
		.links a {
			font-size: 0.75rem;
			letter-spacing: 0.2em;
		}
		.links a.primary {
			flex: 1 0 100%;
			box-sizing: border-box;
			max-width: 20rem;
			margin-bottom: 0.5rem;
			padding: 1rem 1.6rem;
		}
		/* The text links are a 21px line. Open the rows up and grow each hit area
		   to ~44px without moving the underline. */
		.alt {
			margin-bottom: 1.3rem;
		}
		.alt a,
		.call a {
			position: relative;
		}
		.alt a::after,
		.call a::after {
			content: '';
			position: absolute;
			inset: -0.7rem -0.35rem;
		}
		.call-part {
			display: block;
		}
		.call-sep {
			display: none;
		}
		.call-sep + .call-part {
			margin-top: 1.3rem;
		}
	}
</style>
