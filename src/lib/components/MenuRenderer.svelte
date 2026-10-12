<script lang="ts">
	import { imgAttrs, fallback, srcset } from '$lib/media/responsive';
	// Renders a Menu data object as an accessible HTML menu, themed per brand.
	//
	// NO DIETARY LABELS AND NO ALLERGEN LISTS (owner, Aug 2026), matching
	// MenusBrowser. The filter chips went first, then the per-dish Vegan /
	// Vegetarian / Gluten-free pills and the "Contains: …" line. The kitchen
	// adapts many dishes on request, so a fixed label can't say "can be made
	// gluten-free", and the printed allergen matrix is the source of truth.
	// Spicy / New survive because neither is allergen information.
	import type { Menu, DietTag } from '$lib/data/menu-types';
	import { DIET_LABELS } from '$lib/data/menu-types';

	let { menu }: { menu: Menu } = $props();

	const SHOWN_TAGS: DietTag[] = ['spicy', 'new'];
	const shownTags = (tags: DietTag[] | undefined) =>
		(tags ?? []).filter((t) => SHOWN_TAGS.includes(t));

	// Three or more price options ("£13.50 / £14.50 / £15.50 / £17.50"). On a
	// phone those rows put the price on its own line under the name — the same
	// rule, for the same reason, as MenusBrowser's `.dish-top.multi`.
	const multiPrice = (price: string | undefined) => (price?.split('/').length ?? 0) >= 3;
</script>

<div class="menu" data-brand-scope>
	<header class="menu-head">
		<h1 class="menu-title">{menu.title}</h1>
		{#if menu.subtitle}<p class="menu-sub">{menu.subtitle}</p>{/if}

		{#if menu.pdf}
			<a class="pdf" href={menu.pdf} target="_blank" rel="noopener noreferrer"> Download PDF ↓ </a>
		{/if}
	</header>

	{#each menu.sections as section}
		<section class="sect">
			<h2 class="sect-title">{section.title}</h2>
			{#if section.note}<p class="sect-note">{section.note}</p>{/if}

			{#if section.items.length > 0}
				<ul class="items">
					{#each section.items as item}
						<li class="item" class:has-img={item.img}>
							{#if item.img}
								<img
									class="item-img"
									{...imgAttrs(item.img, '120px')}
									alt=""
									loading="lazy"
									decoding="async"
								/>
							{/if}
							<div class="item-body">
								<div class="item-main" class:multi={multiPrice(item.price)}>
									<span class="item-name">
										{item.name}
										{#if item.jp}<span class="jp">{item.jp}</span>{/if}
									</span>
									{#if item.price}<span class="dots" aria-hidden="true"></span><span class="price"
											>{item.price}</span
										>{/if}
								</div>
								{#if item.desc}<p class="item-desc">{item.desc}</p>{/if}
								<!-- No dietary labels and no "Contains:" list — the allergen PDF is
								     the source of truth. See the note at the top of this file. -->
								{#if shownTags(item.tags).length}
									<div class="meta">
										{#each shownTags(item.tags) as t}
											<span class="tag tag-{t}">{DIET_LABELS[t]}</span>
										{/each}
									</div>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
</div>

<style>
	.menu {
		max-width: 880px;
		margin: 0 auto;
		padding: 3rem 1.6rem 5rem;
		font-family: var(--font-serif);
		color: var(--ink);
	}
	.menu-head {
		text-align: center;
		margin-bottom: 3rem;
	}
	.menu-title {
		font-size: clamp(2.4rem, 6vw, 4rem);
		margin: 0 0 0.5rem;
		color: var(--ink);
		font-weight: 500;
		text-wrap: balance;
	}
	.menu-sub {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0 0 1.6rem;
		font-size: 1.15rem;
		/* Centred, so a one-word last line ("… ramen, sushi & / more") shows. */
		text-wrap: balance;
	}
	.pdf {
		display: inline-block;
		margin-top: 0.5rem;
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
	}
	.pdf:hover {
		text-decoration: underline;
	}

	.sect {
		margin-bottom: 3rem;
	}
	.sect-title {
		font-size: 1.7rem;
		color: var(--accent);
		margin: 0 0 0.4rem;
		border-bottom: 1px solid var(--line);
		padding-bottom: 0.6rem;
		font-weight: 500;
	}
	.sect-note {
		font-style: italic;
		color: var(--ink-faint);
		font-size: 0.95rem;
		margin: 0 0 1.2rem;
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.item {
		padding: 1rem 0;
		border-bottom: 1px dashed var(--line);
		transition:
			opacity 0.3s ease,
			filter 0.3s ease;
	}
	.item.has-img {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}
	.item-img {
		flex: 0 0 84px;
		width: 84px;
		height: 84px;
		object-fit: cover;
		border-radius: 8px;
		display: block;
	}
	.item-body {
		flex: 1;
		min-width: 0;
	}
	.item-main {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.item-name {
		font-size: 1.25rem;
		font-weight: 500;
		color: var(--ink);
	}
	.jp {
		font-weight: 300;
		font-size: 0.95rem;
		color: var(--ink-faint);
		margin-left: 0.4rem;
	}
	.dots {
		flex: 1;
		border-bottom: 1px dotted var(--line);
		transform: translateY(-3px);
	}
	.price {
		font-size: 1.1rem;
		color: var(--accent);
		font-weight: 500;
		white-space: nowrap;
	}
	.item-desc {
		margin: 0.3rem 0 0;
		font-size: 1rem;
		font-style: italic;
		color: var(--ink-soft);
		line-height: 1.5;
		max-width: 620px;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.6rem;
		align-items: center;
		margin-top: 0.5rem;
	}
	.tag {
		font-family: var(--font-sans);
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 0.2rem 0.5rem;
		border-radius: 3px;
		background: color-mix(in srgb, var(--accent) 16%, transparent);
		color: var(--accent);
	}
	.tag-spicy {
		background: color-mix(in srgb, #d23b22 18%, transparent);
		color: #e0593f;
	}

	@media (max-width: 600px) {
		/* The route's "‹ All menus" link pads itself on a phone (it is a tap
		   target there), so the page no longer needs 3rem of its own on top. The
		   bottom comes in too: 5rem here, 3rem under the last section and 2rem
		   over "Hungry now?" stacked into a 160px hole before the order buttons. */
		.menu {
			padding: 1.2rem 1.25rem 2.5rem;
		}
		.menu-head {
			margin-bottom: 2.2rem;
		}
		.menu-sub {
			font-size: 1.1rem;
			margin-bottom: 0.6rem;
		}
		/* A 15px-tall line of 11.5px caps is not something a thumb can hit. */
		.pdf {
			margin-top: 0;
			padding: 0.9rem 1rem;
			font-size: 0.75rem;
		}
		.sect {
			margin-bottom: 2.4rem;
		}
		.sect:last-child {
			margin-bottom: 0;
		}
		/* See multiPrice in the script: beside the name, a four-option price left
		   "Rendang Malaysian Curry" a 106px column and three lines. The leader
		   has nothing to lead to once the price is underneath. */
		.item-main.multi {
			flex-wrap: wrap;
			row-gap: 0.15rem;
		}
		.item-main.multi .dots {
			display: none;
		}
		.item-main.multi .price {
			flex: 1 1 100%;
		}
		.tag {
			font-size: 0.68rem;
		}
	}
</style>
