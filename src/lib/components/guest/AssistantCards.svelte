<script lang="ts">
	// Tappable cards rendered under a guest-assistant reply. Fed by the `directives`
	// the /api/chat agent returns from the guest UI tools (show_availability /
	// show_dishes / show_offers) — see src/lib/server/ai/guestTools.ts. Each
	// directive is { tool, input, result }; the result's `kind` picks a renderer:
	//   · availability — heading + tappable time chips linking to the booking page
	//                     (with the chosen time pre-selected), plus the phone note
	//                     for large parties and a friendly empty state.
	//   · dishes        — compact rows (name, price, diet/allergen pills) with the
	//                     "confirm allergens with staff" microcopy.
	//   · offers        — rows (title / when / price) linking to each offer's menu.
	//
	// Brand theming: this component uses the SAME design tokens (var(--accent),
	// var(--line)…) as the chat, so it inherits the brand look from the parent's
	// [data-brand] container. It ALSO carries the Asia cream override block so the
	// cards match the cream panel exactly, scoped to :global([data-brand='asia']).
	// Purely presentational — no data fetching, no writes.

	export type AvailabilityCard = {
		kind: 'availability';
		date: string;
		partySize: number;
		times: string[];
		requiresPhone: boolean;
		bookHref: string;
		/** True when the list was trimmed to a window around a requested time. */
		truncated?: boolean;
		/** The requested time we focused on (24h HH:MM), if any. */
		focusedOn?: string;
		/** True when the guest's requested time wasn't bookable (we show near times). */
		requestedUnavailable?: boolean;
	};
	export type DishesCard = {
		kind: 'dishes';
		capped?: boolean;
		items: Array<{
			name: string;
			desc?: string;
			price?: string;
			tags?: string[];
			allergens?: string[];
			menuSlug?: string;
		}>;
		note?: string;
	};
	export type OffersCard = {
		kind: 'offers';
		items: Array<{ title: string; blurb?: string; when?: string; price?: string; href?: string }>;
	};
	export type Card = AvailabilityCard | DishesCard | OffersCard;

	let { cards }: { cards: Card[] } = $props();

	// Pretty date for the availability heading (Europe/London), defensive on a bad
	// string so a card never throws inside the render.
	function prettyDate(iso: string): string {
		try {
			return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
				weekday: 'long',
				day: 'numeric',
				month: 'long',
				timeZone: 'Europe/London'
			});
		} catch {
			return iso;
		}
	}

	// Link a time chip to the booking page with the time pre-selected. bookHref
	// already carries ?date=&party=; append &time=.
	function timeHref(bookHref: string, time: string): string {
		const sep = bookHref.includes('?') ? '&' : '?';
		return `${bookHref}${sep}time=${encodeURIComponent(time)}`;
	}
</script>

{#each cards as card, i (i)}
	{#if card.kind === 'availability'}
		<div class="card avail">
			<p class="card-head">
				{card.partySize}
				{card.partySize === 1 ? 'guest' : 'guests'} · {prettyDate(card.date)}
			</p>
			{#if card.times.length > 0}
				{#if card.requestedUnavailable}
					<p class="micro">That exact time is full — here are the closest available slots:</p>
				{/if}
				<div class="chips">
					{#each card.times as t (t)}
						<a
							class="chip"
							class:focused={card.focusedOn === t}
							href={timeHref(card.bookHref, t)}>{t}</a
						>
					{/each}
				</div>
				{#if card.requiresPhone}
					<p class="micro">Larger party — we’ll confirm the final details by phone when you book.</p>
				{:else}
					<p class="micro">
						Tap a time to start your booking.{#if card.truncated}
							<a class="seeall" href={card.bookHref}>See all times</a>{/if}
					</p>
				{/if}
			{:else}
				<p class="empty">
					No free tables online for that day. Try another date, or give us a call and we’ll do our
					best to fit you in.
				</p>
			{/if}
		</div>
	{:else if card.kind === 'dishes'}
		<div class="card dishes">
			{#if card.items.length > 0}
				<ul class="rows">
					{#each card.items as d (d.name + (d.menuSlug ?? ''))}
						<li class="row">
							<div class="row-main">
								<span class="name">{d.name}</span>
								{#if d.price}<span class="price">{d.price}</span>{/if}
							</div>
							{#if (d.tags && d.tags.length) || (d.allergens && d.allergens.length)}
								<div class="pills">
									{#each d.tags ?? [] as tag (tag)}
										<span class="pill diet">{tag}</span>
									{/each}
									{#each d.allergens ?? [] as a (a)}
										<span class="pill allergen">{a}</span>
									{/each}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="micro warn">Allergen data may be incomplete — always confirm with staff.</p>
			{:else}
				<p class="empty">
					I couldn’t find a match on the menu. Try different words, or ask staff when you book.
				</p>
			{/if}
		</div>
	{:else if card.kind === 'offers'}
		<div class="card offers">
			{#if card.items.length > 0}
				<ul class="rows">
					{#each card.items as o (o.title)}
						<li class="row offer">
							<a class="offer-link" href={o.href ?? '#'}>
								<div class="row-main">
									<span class="name">{o.title}</span>
									{#if o.price}<span class="price">{o.price}</span>{/if}
								</div>
								{#if o.when}<span class="when">{o.when}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">Nothing running just now — check back soon.</p>
			{/if}
		</div>
	{/if}
{/each}

<style>
	.card {
		align-self: flex-start;
		max-width: 92%;
		margin-top: -0.2rem;
		padding: 0.7rem 0.8rem;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 14px;
		border-bottom-left-radius: 4px;
		font-size: 0.84rem;
		color: var(--ink);
	}
	.card-head {
		margin: 0 0 0.55rem;
		font-family: var(--font-body, sans-serif);
		font-size: 0.7rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	/* availability — tappable time chips */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 3.4rem;
		min-height: 2rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
		font-size: 0.82rem;
		text-decoration: none;
		transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
	}
	.chip:hover {
		background: var(--accent);
		color: var(--bg);
		transform: translateY(-1px);
	}
	/* The time the guest actually asked for — filled in so it reads as the default. */
	.chip.focused {
		background: var(--accent);
		color: var(--bg);
		font-weight: 600;
	}
	.seeall {
		margin-left: 0.4rem;
		color: var(--accent);
		text-decoration: underline;
	}

	/* dish + offer rows */
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
	}
	.row:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.row-main {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.name {
		font-weight: 500;
	}
	.price {
		flex: 0 0 auto;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}
	.when {
		font-size: 0.76rem;
		color: var(--ink-soft);
	}

	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.pill {
		font-family: var(--font-body, sans-serif);
		font-size: 0.64rem;
		letter-spacing: 0.04em;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--ink-soft);
		text-transform: none;
	}
	.pill.diet {
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
		color: var(--accent);
	}
	.pill.allergen {
		border-style: dashed;
	}

	.offer .offer-link {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		text-decoration: none;
		color: inherit;
	}
	.offer .offer-link:hover .name {
		color: var(--accent);
	}

	.micro {
		margin: 0.5rem 0 0;
		font-size: 0.7rem;
		color: var(--ink-faint);
	}
	.micro.warn {
		color: var(--ink-soft);
		font-style: italic;
	}
	.empty {
		margin: 0;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	/* ===== ASIA override — the redesign language, matching the chat panel =====
	   Square edges on an ink ground, gold hairlines, sakura on anything tappable.
	   These cards only ever render inside that panel, so they follow it exactly. */
	:global([data-brand='asia']) .card {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-left: 1px solid rgba(212, 175, 55, 0.55);
		border-radius: 0;
		color: rgba(245, 241, 232, 0.92);
		font-family: 'Jost', system-ui, sans-serif;
	}
	:global([data-brand='asia']) .card-head {
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.62rem;
		letter-spacing: 0.2em;
		color: #a3a0a0;
	}
	/* Times are the panel's starter chips: spaced caps behind a gold hairline. */
	:global([data-brand='asia']) .chip {
		border-radius: 0;
		border-color: rgba(212, 175, 55, 0.45);
		background: transparent;
		color: #f5f1e8;
		letter-spacing: 0.08em;
	}
	:global([data-brand='asia']) .chip:hover,
	:global([data-brand='asia']) .chip.focused {
		background: linear-gradient(120deg, #ef3c5c, #ff7a94);
		border-color: #ff7a94;
		color: #fff;
	}
	:global([data-brand='asia']) .seeall {
		color: #ff7a94;
	}
	:global([data-brand='asia']) .row {
		border-bottom-color: rgba(255, 255, 255, 0.1);
	}
	:global([data-brand='asia']) .price,
	:global([data-brand='asia']) .pill.diet,
	:global([data-brand='asia']) .offer .offer-link:hover .name {
		color: #ff7a94;
	}
	:global([data-brand='asia']) .pill {
		border-radius: 0;
		border-color: rgba(255, 255, 255, 0.14);
		color: #a3a0a0;
	}
	:global([data-brand='asia']) .pill.diet {
		border-color: rgba(255, 122, 148, 0.5);
		color: #ff7a94;
	}
	:global([data-brand='asia']) .when {
		color: #a3a0a0;
	}
	:global([data-brand='asia']) .micro {
		color: rgba(245, 241, 232, 0.55);
	}
	:global([data-brand='asia']) .micro.warn,
	:global([data-brand='asia']) .empty {
		color: rgba(245, 241, 232, 0.68);
	}
</style>
