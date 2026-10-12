<script lang="ts">
	// "The Circle — coming soon" holding panel.
	//
	// The rewards programme is built and admin-editable, but not launched (see
	// CIRCLE_LIVE in $lib/data/features). The nav greys the entry out, so this page
	// is only reached from a bookmark, a search result or a typed URL — it must not
	// 404, and it must not advertise a scheme nobody can join yet. It says what's
	// coming and points at what guests CAN do today.
	import type { Brand } from '$lib/data/brand';

	let { brand, name = 'The Circle' }: { brand: Brand; name?: string } = $props();
	const base = $derived(`/${brand.id}`);
</script>

<section class="soon-panel" data-brand={brand.id}>
	<div class="inner">
		<span class="eyebrow">Coming soon</span>
		<h1>{name}</h1>
		<p class="lead">
			Our rewards programme is on its way — earn on every visit across both Geisha restaurants and
			spend it on the food you love.
		</p>
		<p class="note">
			It isn't open for sign-ups yet. We'll announce it here and on our social channels the moment
			it is.
		</p>
		<div class="cta">
			<a class="primary" href="{base}/bookings">Book a table</a>
			<a class="ghost" href="{base}/menus">See the menus</a>
		</div>
	</div>
</section>

<style>
	.soon-panel {
		min-height: 70vh;
		display: grid;
		place-items: center;
		padding: clamp(4rem, 14vh, 9rem) 1.5rem;
		background: var(--bg, #14100c);
		color: var(--ink, #f4ece0);
	}
	.inner {
		max-width: 44rem;
		text-align: center;
	}
	.eyebrow {
		display: inline-block;
		font-family: var(--font-sans, 'Space Grotesk', sans-serif);
		font-size: 0.66rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--accent, #b8722a);
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0.35rem 0.9rem;
		margin-bottom: 1.4rem;
	}
	h1 {
		font-family: var(--font-serif, 'Cormorant Garamond', serif);
		font-weight: 300;
		font-size: clamp(2.6rem, 8vw, 4.6rem);
		line-height: 1.05;
		margin: 0 0 1.2rem;
	}
	.lead {
		font-family: var(--font-serif, 'Cormorant Garamond', serif);
		font-size: clamp(1.1rem, 2.4vw, 1.45rem);
		line-height: 1.6;
		margin: 0 auto 1rem;
		max-width: 34rem;
		color: var(--ink-soft, inherit);
	}
	.note {
		font-family: var(--font-sans, 'Space Grotesk', sans-serif);
		font-size: 0.86rem;
		line-height: 1.7;
		color: var(--ink-faint, var(--ink-soft, inherit));
		margin: 0 auto 2.2rem;
		max-width: 30rem;
	}
	.cta {
		display: flex;
		gap: 0.8rem;
		justify-content: center;
		flex-wrap: wrap;
	}
	.cta a {
		font-family: var(--font-sans, 'Space Grotesk', sans-serif);
		font-size: 0.68rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		text-decoration: none;
		padding: 0.95rem 1.8rem;
		/* Both buttons carry a 1px border so the pair is the same height — the
		   ghost's outline used to make it 2px taller than the filled one. */
		border: 1px solid transparent;
	}
	.primary {
		background: var(--accent, #b8722a);
		color: var(--bg, #14100c);
	}
	.cta a.ghost {
		border-color: currentColor;
		color: var(--ink-soft, inherit);
	}
	.cta a:hover {
		opacity: 0.85;
	}

	/* ── Phone ──────────────────────────────────────────────────────────────
	   The 70vh floor plus 14vh of padding each side left over 200px of empty
	   screen above a five-line message. Drop the floor and let the padding set
	   the height; the two buttons stack as an equal-width pair. */
	@media (max-width: 640px) {
		.soon-panel {
			min-height: 0;
			padding: clamp(3.5rem, 11vh, 6rem) 1.5rem clamp(4rem, 12vh, 6.5rem);
		}
		.eyebrow {
			font-size: 0.75rem;
			letter-spacing: 0.28em;
			padding: 0.4rem 1rem;
		}
		.note {
			text-wrap: balance;
		}
		.cta {
			flex-direction: column;
			align-items: center;
		}
		.cta a {
			box-sizing: border-box;
			width: min(100%, 17rem);
			font-size: 0.75rem;
			letter-spacing: 0.24em;
			text-align: center;
			padding: 1rem 1.2rem;
		}
	}
</style>
