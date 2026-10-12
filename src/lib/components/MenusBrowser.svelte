<script lang="ts">
	// THE MENUS PAGE — every dish, browsable in the page.
	//
	// Replaces FusionMenuGallery, the expanding 8-panel accordion where each panel
	// was a link straight to a PDF ("the 8 things" the client objected to). A guest
	// had to guess which of eight covers held what they wanted, then leave the site
	// into a PDF viewer to find out.
	//
	// Modelled on the design template's `#view-menu` "live interactive menu":
	// a stat-bearing hero, a search box, a sticky row of category tabs, and dishes
	// in a two-column editorial list. The template only ever had ONE menu; these
	// brands have eight each, so a menu switcher sits above the toolbar and
	// everything below it re-renders for the chosen menu.
	//
	// NO DIETARY FILTER AND NO ALLERGEN LABELS (owner, Aug 2026).
	//
	// This page used to carry All / Vegan / Vegetarian / Gluten-free / Spicy / New
	// filter chips AND a Vegan/Vegetarian/Gluten-free pill on each dish. Both are
	// gone. The kitchen adapts many dishes on request, so a fixed per-dish label
	// can't express "can be made gluten-free" — it under-sells what a guest can
	// actually eat, and the filter went further and HID the rest. The owner's
	// position is that the printed allergen matrix (each brand's "Allergens &
	// Dietary" PDF) is the single source of truth, and the website's job is to
	// send people to it. Hence `SHOWN_TAGS` and the notice above the dish list.
	//
	// Spicy and New still show: neither is allergen information.
	//
	// Don't reinstate either without talking to the owner — this is a safety
	// position, not a design preference.
	//
	// The PDFs are NOT dropped — the template's hero boasts "no PDF required", but
	// staff hand these out at the table and guests print them, so each menu keeps
	// View / Download buttons in the toolbar.
	import type { Brand } from '$lib/data/brand';
	import {
		DIET_LABELS,
		menuFileKind,
		type DietTag,
		type Menu,
		type MenuItem
	} from '$lib/data/menu-types';
	import { srcset, fallback } from '$lib/media/responsive';
	import { onMount, tick } from 'svelte';

	// The artwork the dish list is read over. `bgImage` is the fallback <img> src;
	// `bgSrcset` lets a caller supply its own avif/webp ladder for assets that
	// aren't in the media manifest (Asia's /art/ watercolour is hand-encoded, the
	// same way HomeSections declares it). Without it we derive the ladder from the
	// manifest, which is what CMS-managed images need.
	let {
		brand,
		menus,
		bgImage,
		bgSrcset
	}: {
		brand: Brand;
		menus: Menu[];
		bgImage?: string;
		bgSrcset?: { avif?: string; webp?: string };
	} = $props();

	const artAvif = $derived(bgSrcset?.avif ?? (bgImage ? srcset(bgImage, 'avif') : ''));
	const artWebp = $derived(bgSrcset?.webp ?? (bgImage ? srcset(bgImage, 'webp') : ''));

	/**
	 * Tags that may appear on a dish. NOT 'v' / 'vg' / 'gf' — those are dietary
	 * claims, and the owner's position (Aug 2026) is that the PDF allergen matrix
	 * is the single source of truth for them, because the kitchen adapts dishes on
	 * request and a per-dish label on the website can't express "can be made
	 * gluten-free". Spicy and New stay: neither is allergen information.
	 */
	const SHOWN_TAGS: DietTag[] = ['spicy', 'new'];
	const shownTags = (tags: DietTag[] | undefined) =>
		(tags ?? []).filter((t) => SHOWN_TAGS.includes(t));

	/** The brand's allergen menu, so the notice can link straight to its PDF. */
	const allergenPdf = $derived(
		menus.find((m) => m.slug === 'allergens' || /allergen/i.test(m.title))?.pdf ?? ''
	);

	// `chosen` is null until the guest picks (or a ?m= deep link resolves), so the
	// first menu is a DERIVED default rather than an initial-value snapshot of the
	// prop — that keeps it correct if the CMS reorders or renames menus.
	let chosen = $state<string | null>(null);
	let query = $state('');

	const menu = $derived(menus.find((m) => m.slug === chosen) ?? menus[0]);
	const activeSlug = $derived(menu?.slug ?? '');

	// ----- Search -----
	const matches = (it: MenuItem) => {
		const q = query.trim().toLowerCase();
		if (!q) return true;
		return `${it.name} ${it.desc ?? ''} ${it.price ?? ''}`.toLowerCase().includes(q);
	};

	// Sections with their items filtered; empty sections drop out entirely so the
	// category tabs never point at a heading with nothing under it.
	const shownSections = $derived(
		(menu?.sections ?? [])
			.map((s) => ({ ...s, items: s.items.filter(matches) }))
			.filter((s) => s.items.length > 0)
	);
	const shownCount = $derived(shownSections.reduce((n, s) => n + s.items.length, 0));

	const filtering = $derived(query.trim() !== '');
	function clearFilters() {
		query = '';
	}

	// A PDF-only menu (each brand's "Allergens & Dietary") has no dishes at all.
	// It must not offer a search box with nothing to search, nor fall into the
	// "No dishes match your search" message when nobody has searched.
	const hasDishes = $derived((menu?.sections ?? []).some((s) => s.items.length > 0));

	// "£13.50 / £14.50 / £15.50 / £17.50" — three or more options. On a phone a
	// price that long squeezes the dish name into a 90px column, so those rows
	// drop the price onto its own line (see `.dish-top.multi`). Decided by the
	// NUMBER of options, not by measured width: a width test put the break in
	// the middle of the wine list, where near-identical prices landed on
	// different sides of it.
	const multiPrice = (price: string | undefined) => (price?.split('/').length ?? 0) >= 3;

	// A slug per section, for the tab anchors.
	const sectionId = (title: string) =>
		'sec-' +
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');

	// ----- Menu switching -----
	// Deep-linkable, so "here's the Sunday menu" is a shareable URL. replaceState
	// rather than goto: this is a filter on one page, and pushing eight history
	// entries would trap the back button.
	function selectMenu(slug: string) {
		chosen = slug;
		clearFilters();
		// The scroll-spy's last answer belongs to the menu being left. Kept, it
		// matches no tab in the new one and the strip shows nothing selected.
		activeSection = '';
		if (typeof window !== 'undefined') {
			const url = new URL(window.location.href);
			url.searchParams.set('m', slug);
			history.replaceState(history.state, '', url);
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	}
	onMount(() => {
		const want = new URL(window.location.href).searchParams.get('m');
		if (want && menus.some((m) => m.slug === want)) chosen = want;
	});

	// Keep the chosen menu's card in view in the switcher. On a phone only one and
	// a half cards fit, so a ?m= deep link (or a reload) to the sixth menu opened
	// with nothing selected on screen and no clue which menu the dishes belong to.
	// Scrolls the strip itself, never the page — scrollIntoView would move both.
	let switchEl = $state<HTMLElement>();
	$effect(() => {
		const strip = switchEl;
		const el = strip?.querySelector<HTMLElement>(`[data-menu="${activeSlug}"]`);
		if (!strip || !el) return;
		const left =
			el.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
		const target = left - (strip.clientWidth - el.offsetWidth) / 2;
		strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
	});

	// ----- Category tabs -----
	let tabsEl = $state<HTMLElement>();
	let activeSection = $state('');
	let canLeft = $state(false);
	let canRight = $state(false);

	function syncArrows() {
		const el = tabsEl;
		if (!el) return;
		canLeft = el.scrollLeft > 4;
		canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
	}
	function nudge(dir: -1 | 1) {
		tabsEl?.scrollBy({
			left: dir * Math.max(200, (tabsEl.clientWidth ?? 0) * 0.7),
			behavior: 'smooth'
		});
	}

	function goToSection(title: string) {
		const el = document.getElementById(sectionId(title));
		if (!el) return;
		// The tab bar is sticky, so scrollIntoView would park the heading underneath
		// it. Offset by the bar's own height plus the fixed brand nav above it.
		const top = el.getBoundingClientRect().top + window.scrollY - stickyOffset() - 12;
		window.scrollTo({ top, behavior: 'smooth' });
	}
	const stickyOffset = () => {
		// Mirrors `.tabs-wrap { top }` below — keep the three tiers in step.
		// (Fusion's phone bar is 2px taller, exactly as in the CSS.)
		const phoneNav = brand.id === 'fusion' ? 54 : 52;
		const nav = window.innerWidth <= 600 ? phoneNav : window.innerWidth <= 1300 ? 70 : 92;
		return nav + (tabsEl?.offsetHeight ?? 56);
	};

	// Scroll-spy: highlight the category the guest is actually reading.
	$effect(() => {
		// Re-observe whenever the visible section set changes (menu switch, search).
		const ids = shownSections.map((s) => sectionId(s.title));
		if (!ids.length) return;
		const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
		if (!els.length) return;
		const io = new IntersectionObserver(
			(entries) => {
				// Nearest heading to the top of the readable area wins.
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible[0]) activeSection = visible[0].target.id;
			},
			{ rootMargin: `-${stickyOffset() + 20}px 0px -55% 0px`, threshold: 0 }
		);
		els.forEach((el) => io.observe(el));
		return () => io.disconnect();
	});

	// Keep the active tab scrolled into view as the page moves past categories.
	$effect(() => {
		const id = activeSection;
		const el = tabsEl?.querySelector<HTMLElement>(`[data-sec="${id}"]`);
		if (!el || !tabsEl) return;
		const target = el.offsetLeft - (tabsEl.clientWidth - el.offsetWidth) / 2;
		tabsEl.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
	});

	$effect(() => {
		void shownSections.length;
		tick().then(syncArrows);
	});
</script>

<svelte:window onresize={syncArrows} />

<section class="menus" data-brand={brand.id}>
	<!-- ===== Hero ===== -->
	<header class="mhead">
		<span class="eyebrow">{brand.name}</span>
		<h1>The Full <em>Menu</em></h1>
		<p class="lede">
			Every dish, straight from our kitchen — searchable and built to browse on your phone at the
			table. The printed PDFs are here too.
		</p>
	</header>

	<!-- ===== Menu switcher — replaces the 8-panel PDF accordion ===== -->
	<nav class="switch" aria-label="Choose a menu" bind:this={switchEl}>
		{#each menus as m}
			<button
				class="mtab"
				class:on={m.slug === activeSlug}
				data-menu={m.slug}
				onclick={() => selectMenu(m.slug)}
			>
				<span class="mtab-title">{m.title}</span>
				{#if m.subtitle}<span class="mtab-sub">{m.subtitle}</span>{/if}
			</button>
		{/each}
	</nav>

	{#if menu}
		<!-- ===== Toolbar: search + the PDFs ===== -->
		<div class="toolbar">
			{#if hasDishes}
				<div class="search">
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg
					>
					<input
						type="search"
						bind:value={query}
						placeholder="Search {menu.title.toLowerCase()}…"
						aria-label="Search {menu.title}"
					/>
				</div>
			{/if}

			{#if menu.pdf}
				<div class="pdfs">
					<a class="pdf-btn" href={menu.pdf} target="_blank" rel="noopener">
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M4 4h10l6 6v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path
								d="M14 4v6h6"
							/></svg
						>
						View {menuFileKind(menu.pdf)}
					</a>
					<a class="pdf-btn ghost" href={menu.pdf} download>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></svg
						>
						Download
					</a>
				</div>
			{/if}
		</div>

		<!-- ===== Category tabs ===== -->
		{#if shownSections.length > 1}
			<div class="tabs-wrap">
				<button
					class="tabs-arrow left"
					onclick={() => nudge(-1)}
					disabled={!canLeft}
					aria-label="Scroll categories left"
					tabindex="-1"
					><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg></button
				>
				<div class="tabs" bind:this={tabsEl} onscroll={syncArrows}>
					<!-- Until the scroll-spy has observed anything, the first category is
					     the one being read — otherwise the strip sits with nothing
					     highlighted on first paint. -->
					{#each shownSections as s, i}
						<button
							class="tab"
							class:on={activeSection ? activeSection === sectionId(s.title) : i === 0}
							data-sec={sectionId(s.title)}
							onclick={() => goToSection(s.title)}>{s.title}</button
						>
					{/each}
				</div>
				<button
					class="tabs-arrow right"
					onclick={() => nudge(1)}
					disabled={!canRight}
					aria-label="Scroll categories right"
					tabindex="-1"
					><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button
				>
			</div>
		{/if}

		<!-- ===== Allergen notice =====
		     ABOVE the dishes, not below them. There is a closing line at the foot of
		     the page too, but a guest scanning for "is there anything I can eat"
		     decides before they get there — and since the dietary labels were taken
		     off the dishes, this notice is now the only thing on the page telling
		     them where that information lives. -->
		<div class="allergen-note">
			<p>
				<strong>Allergies or dietary requirements?</strong> This page doesn&rsquo;t label individual dishes.
				Our allergen menu lists every dish against all 14 major allergens, and many dishes can be adapted
				— so please ask us.
			</p>
			{#if allergenPdf}
				<a class="allergen-btn" href={allergenPdf} target="_blank" rel="noopener">
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M4 4h10l6 6v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path
							d="M14 4v6h6"
						/></svg
					>
					Allergen menu (PDF)
				</a>
			{/if}
		</div>

		<!-- ===== Dishes ===== -->
		{#if filtering}
			<p class="result-line">
				{shownCount}
				{shownCount === 1 ? 'dish' : 'dishes'}
				{#if query.trim()}matching “{query.trim()}”{/if}
				<button class="clear" onclick={clearFilters}>Clear</button>
			</p>
		{/if}

		{#if shownSections.length === 0}
			<!-- Only a search can empty a menu that has dishes. A PDF-only menu is
			     empty by nature and says nothing here — its View / Download buttons
			     above are the whole of it. -->
			{#if hasDishes}
				<p class="empty">
					No dishes match your search — <button class="clear" onclick={clearFilters}>clear it</button
					>
					to see the whole menu.
				</p>
			{/if}
		{:else}
			<div class="dishes">
				<!-- Brand artwork behind the dish list — the Asia geisha portrait, the
			     Fusion mural. The image is STICKY inside this wrapper rather than
			     position:fixed: fixed would hold it over the whole viewport, so it
			     would still be sitting there behind the footer at the bottom of a
			     very long menu. Sticky gives the same "list scrolls over a still
			     picture" feel but cannot escape the dish list. aria-hidden — it's
			     atmosphere, and the scrim over it is what keeps 200-odd dish
			     descriptions readable. -->
				{#if bgImage}
					<div class="art" aria-hidden="true">
						<div class="art-inner">
							<picture>
								{#if artAvif}<source type="image/avif" srcset={artAvif} sizes="100vw" />{/if}
								{#if artWebp}<source type="image/webp" srcset={artWebp} sizes="100vw" />{/if}
								<img src={fallback(bgImage) ?? bgImage} alt="" decoding="async" />
							</picture>
						</div>
					</div>
				{/if}

				{#each shownSections as s (s.title)}
					<section class="cat" id={sectionId(s.title)}>
						<div class="cat-head">
							<h2>{s.title}</h2>
							<span class="cat-count">{s.items.length}</span>
						</div>
						{#if s.note}<p class="cat-note">{s.note}</p>{/if}
						<div class="grid">
							{#each s.items as it (it.name + (it.price ?? ''))}
								<article class="dish">
									<div class="dish-top" class:multi={multiPrice(it.price)}>
										<h3>{it.name}</h3>
										{#if it.price}<span class="price">{it.price}</span>{/if}
									</div>
									{#if it.desc}<p class="dish-desc">{it.desc}</p>{/if}
									<!-- Dietary/allergen labels are deliberately NOT rendered here — see
								     the note at the top of this file. Only Spicy and New survive,
								     and only because neither is allergen information. -->
									{#if shownTags(it.tags).length}
										<div class="tags">
											{#each shownTags(it.tags) as t}
												<span class="pill" class:spicy={t === 'spicy'} class:fresh={t === 'new'}
													>{DIET_LABELS[t]}</span
												>
											{/each}
										</div>
									{/if}
								</article>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}

		<p class="allergy">
			Please tell your server about any allergy or intolerance before ordering. Recipes change, so
			check the allergen menu on each visit rather than relying on a previous one.
		</p>
	{/if}
</section>

<style>
	.menus {
		/* The "hot" colour — used for every ACTIVE/selected state and the primary
		   action, while --accent stays the structural colour for headings, the
		   eyebrow and the category rules. That split is the site's own
		   rule (see tokens.css: sakura is the action colour, gold is the frame).
		   Callers opt in by setting --menu-hot on a wrapper.
		   It CANNOT be done by overriding --accent on that wrapper: this element
		   carries data-brand, and `[data-brand='asia']` re-declares --accent right
		   here, so an inherited value never survives. --menu-hot isn't in that
		   block, so it inherits cleanly. */
		--hot: var(--menu-hot, var(--accent));
		/* The side gutter, named so the two phone scrollers (menu switcher, category
		   tabs) can bleed out through it to the screen edge and pad back in. */
		--gutter: clamp(1rem, 4vw, 2.4rem);
		max-width: 1240px;
		margin: 0 auto;
		padding: 0 var(--gutter) 4rem;
		color: var(--ink);
		/* .dishes bleeds its artwork out to 100vw, and 100vw INCLUDES the vertical
		   scrollbar — so on a page tall enough to scroll (i.e. this one) it
		   overhangs by the scrollbar width and the whole page scrolls sideways.
		   `clip` rather than `hidden`: hidden would make this a scroll container
		   and kill the sticky category tabs. */
		overflow-x: clip;
	}

	/* ----- Hero ----- */
	.mhead {
		text-align: center;
		padding: clamp(2rem, 5vw, 3.4rem) 0 clamp(1.6rem, 3vw, 2.4rem);
	}
	.eyebrow {
		display: inline-block;
		font-family: var(--font-body);
		font-size: 0.68rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 0.9rem;
	}
	.mhead h1 {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: clamp(2.2rem, 5.6vw, 3.8rem);
		line-height: 1.05;
		margin: 0 0 0.9rem;
	}
	.mhead h1 em {
		font-style: italic;
		/* The emphasis word, in the action colour — the same move the home hero
		   makes with its highlighted word. */
		color: var(--hot);
	}
	.lede {
		font-family: var(--font-body);
		font-size: clamp(0.92rem, 1.3vw, 1.02rem);
		line-height: 1.65;
		color: var(--ink-soft);
		max-width: 62ch;
		margin: 0 auto;
	}
	@media (max-width: 760px) {
		/* PHONE: GET TO THE FOOD. As shipped, hero + switcher + search + PDFs +
		   category tabs + allergen notice ran 843px before the first dish — at a
		   table, on a 844px-tall phone, the menu page opened with no menu on it.
		   Every block from here down to the dish list gives back a little
		   vertical space under this same 760px query; together it is ~110px,
		   enough to put the first category heading on the opening screen. Nothing
		   is removed, and nothing changes above 760px. */
		.mhead {
			padding: 1.4rem 0 1.2rem;
		}
		.eyebrow {
			margin-bottom: 0.55rem;
		}
		.mhead h1 {
			margin-bottom: 0.6rem;
		}
		.lede {
			line-height: 1.55;
			/* Centred text: even out the lines rather than end on "here too." */
			text-wrap: balance;
		}
	}

	/* ----- Menu switcher ----- */
	.switch {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 3px;
		margin-bottom: 1.6rem;
		scroll-snap-type: x proximity;
	}
	.switch::-webkit-scrollbar {
		display: none;
	}
	.mtab {
		flex: none;
		scroll-snap-align: start;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		text-align: left;
		padding: 0.75rem 1.2rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg-2);
		color: var(--ink-soft);
		cursor: pointer;
		transition:
			border-color 0.25s ease,
			background 0.25s ease,
			color 0.25s ease;
	}
	.mtab:hover {
		border-color: var(--hot);
		color: var(--ink);
	}
	.mtab.on {
		background: var(--hot);
		border-color: var(--hot);
		color: var(--bg);
	}
	.mtab-title {
		font-family: var(--font-display);
		font-size: 1rem;
		line-height: 1.1;
	}
	.mtab-sub {
		font-family: var(--font-body);
		font-size: 0.66rem;
		letter-spacing: 0.06em;
		opacity: 0.75;
		max-width: 26ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (max-width: 760px) {
		/* Run the strip out to the screen edge: cards sliding off the glass say
		   "there is more this way" far better than a row that stops at the text
		   column. The gutter comes back as padding (and scroll-padding, so snap
		   points and the first card still sit on the page's left edge). */
		.switch {
			margin: 0 calc(-1 * var(--gutter)) 0.9rem;
			padding: 3px var(--gutter);
			scroll-padding-inline: var(--gutter);
		}
		.mtab {
			padding: 0.65rem 1rem;
		}
		.mtab-sub {
			/* 10.5px was under the phone floor for something a guest must read to
			   tell "Evening Special" from "Daytime Special". */
			font-size: 0.75rem;
			letter-spacing: 0.03em;
		}
	}

	/* ----- Toolbar ----- */
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.9rem 1.2rem;
		margin-bottom: 1.2rem;
	}
	.search {
		position: relative;
		flex: 1 1 240px;
		max-width: 340px;
	}
	.search svg {
		position: absolute;
		left: 13px;
		top: 50%;
		transform: translateY(-50%);
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--ink-faint);
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: none;
	}
	.search input {
		width: 100%;
		box-sizing: border-box;
		font-family: var(--font-body);
		font-size: 0.9rem;
		color: var(--ink);
		background: var(--bg-2);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0.78rem 0.9rem 0.78rem 2.4rem;
		transition: border-color 0.25s ease;
	}
	.search input::placeholder {
		color: var(--ink-faint);
	}
	.search input:focus {
		outline: none;
		border-color: var(--hot);
	}
	.pdfs {
		display: flex;
		gap: 0.5rem;
		margin-left: auto;
	}
	.pdf-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-family: var(--font-body);
		font-size: 0.68rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		text-decoration: none;
		padding: 0.7rem 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--hot);
		background: var(--hot);
		color: var(--bg);
		white-space: nowrap;
		transition: opacity 0.2s ease;
	}
	.pdf-btn.ghost {
		background: transparent;
		color: var(--hot);
	}
	.pdf-btn:hover {
		opacity: 0.85;
	}
	.pdf-btn svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@media (max-width: 760px) {
		.toolbar {
			gap: 0.6rem;
			margin-bottom: 0.7rem;
		}
		/* The search capped at 340px and the two PDF pills hung off the right with
		   a ragged hole to their left. On a phone each row fills the column: the
		   search full width, the pills an even pair at a thumb's 44px. */
		.search {
			flex: 1 1 100%;
			max-width: none;
		}
		.search input {
			/* 16px, not 14.4: iOS Safari zooms the whole page in when a focused input
			   is set smaller than that, and never zooms back out. */
			font-size: 1rem;
			padding-block: 0.7rem;
		}
		.pdfs {
			flex: 1 1 100%;
			margin-left: 0;
		}
		.pdf-btn {
			flex: 1;
			justify-content: center;
			box-sizing: border-box;
			min-height: 44px;
			padding-block: 0;
			font-size: 0.72rem;
		}
	}

	/* ----- Category tabs ----- */
	.tabs-wrap {
		position: sticky;
		/* Clears the fixed brand nav (BrandTopNav: 92px, 70px under 1300). */
		top: 92px;
		z-index: 20;
		margin-bottom: 0.4rem;
		background: var(--bg);
		/* The arrows are FLEX SIBLINGS of the scroller, not an overlay on top of
		   it. Floating them over the track only looks right at scrollLeft 0 — the
		   moment the guest scrolls, tabs slide underneath and the first and last
		   ones read as clipped. Side padding can't fix that: it scrolls away with
		   the content. */
		display: flex;
		align-items: stretch;
		gap: 0.3rem;
		border-bottom: 1px solid var(--line);
	}
	@media (max-width: 1300px) {
		.tabs-wrap {
			top: 70px;
		}
	}
	@media (max-width: 600px) {
		/* By the time this bar sticks the page is scrolled, and under 600px the
		   scrolled brand nav is 10 + 32 + 10 = 52px (BrandTopNav), not 70. Parked
		   at 70 it left an 18px slot between the two bars with dish text sliding
		   through it. stickyOffset() in the script carries the same number. */
		.tabs-wrap {
			top: 52px;
		}
		/* Fusion's two-line wordmark holds 34px when scrolled, so its bar is 54. */
		.menus[data-brand='fusion'] .tabs-wrap {
			top: 54px;
		}
	}
	.tabs {
		flex: 1;
		min-width: 0; /* or the scroller refuses to shrink and overflows the row */
		display: flex;
		gap: 0.45rem;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 0.9rem 0.2rem;
		scroll-snap-type: x proximity;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	.tab {
		flex: none;
		scroll-snap-align: start;
		font-family: var(--font-body);
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		white-space: nowrap;
		padding: 0.6rem 1.05rem;
		border: 1px solid var(--line);
		border-radius: 3px;
		background: var(--bg-2);
		color: var(--ink-soft);
		cursor: pointer;
		transition: all 0.22s ease;
	}
	.tab:hover {
		border-color: var(--hot);
		color: var(--ink);
	}
	.tab.on {
		background: var(--hot);
		border-color: var(--hot);
		color: var(--bg);
		font-weight: 500;
	}
	.tabs-arrow {
		flex: none;
		align-self: center;
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--bg);
		cursor: pointer;
		transition: opacity 0.2s ease;
	}
	.tabs-arrow svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: var(--ink);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.tabs-arrow:hover {
		border-color: var(--accent);
	}
	/* Hidden rather than removed: as a flex item it keeps its width, so the track
	   doesn't jump sideways each time an arrow becomes available. */
	.tabs-arrow[disabled] {
		opacity: 0;
		pointer-events: none;
	}
	@media (max-width: 760px) {
		/* Touch scrolls the track directly; the arrows are just lost width. */
		.tabs-arrow {
			display: none;
		}
		/* With the arrows gone, nothing said these tracks scroll. Both overflow hard
		   at 393px — the category strip runs 2094px against a 345px window, the menu
		   switcher 1614px — so the right-hand tab was sliced clean through its label
		   ("Evening Specia…") and read as a layout bug rather than an invitation.
		   Fading the trailing edge makes the cut deliberate. */
		.tabs,
		.switch {
			/* The fade is the gutter and no wider: both tracks now end in a gutter of
			   padding, so scrolled to the far end the last tab stands clear of it.
			   At the old flat 34px the final tab was always half dissolved. */
			-webkit-mask-image: linear-gradient(
				to right,
				#000 calc(100% - var(--gutter) - 4px),
				transparent
			);
			mask-image: linear-gradient(to right, #000 calc(100% - var(--gutter) - 4px), transparent);
		}
		/* A solid bar from screen edge to screen edge, flush under the nav. Held to
		   the text column it floated as a box over the artwork with the picture
		   showing down both sides of it. The tabs themselves keep the page's left
		   edge via the padding. */
		.tabs-wrap {
			margin-inline: calc(-1 * var(--gutter));
		}
		.tabs {
			padding: 0.6rem var(--gutter);
			scroll-padding-inline: var(--gutter);
		}
		.tab {
			/* 36px tall and 10.9px type: under a thumb's 44 and under the phone
			   floor for text. 40px keeps the bar slim while it rides the screen. */
			min-height: 40px;
			padding: 0 0.95rem;
			font-size: 0.75rem;
			letter-spacing: 0.1em;
		}
	}

	/* ----- Dishes ----- */
	.result-line {
		font-family: var(--font-body);
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		color: var(--ink-faint);
		margin: 1.2rem 0 0;
	}
	.clear {
		font: inherit;
		border: 0;
		background: none;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
		padding: 0 0 0 0.4rem;
	}
	@media (max-width: 760px) {
		.result-line {
			margin: 0.9rem 0 0.2rem;
		}
		/* An 18px-tall word is not a tap target. Pad it out and take the padding
		   back in margin, so the line it sits in doesn't grow — sideways as well
		   as vertically. Only the block margin was taken back at first, and the
		   empty-state sentence read "— ·clear it· to see" with a hole each side
		   of the link. The 0.1rem short on the left keeps the base rule's 0.4rem
		   lead-in after "matching …". */
		.clear {
			padding: 0.6rem 0.5rem;
			margin: -0.6rem -0.5rem -0.6rem -0.1rem;
		}
		/* Mid-sentence there are real spaces either side already. */
		.empty .clear {
			margin-inline: -0.5rem;
		}
	}
	/* ----- Brand artwork behind the dish list ----- */
	.dishes {
		position: relative;
		/* The art is bled out to the full viewport width — the .menus container is
		   capped at 1240px, and a backdrop that stops at the text column reads as a
		   panel rather than as the room behind the menu. */
		margin-inline: calc(50% - 50vw);
		padding-inline: calc(50vw - 50%);
	}
	.art {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		/* NO `overflow: hidden` here. It would make .art the sticky child's nearest
		   scroll container, which pins the image to the top of the dish list and
		   leaves every screen below it bare — the sticky element needs the DOCUMENT
		   as its scrollport. It can't escape this box anyway: sticky is clamped to
		   its containing block. */
	}
	/* One viewport-tall sticky panel holding the image AND its scrim. Both have to
	   be on the sticky element: an inset:0 gradient on .art would stretch over the
	   whole (very tall) dish list, so its "lighter at the top" end would only ever
	   land on the first screen and every screen after it got the heavy end — which
	   washed the artwork out to nothing. */
	.art-inner {
		position: sticky;
		top: 0;
		height: 100vh;
	}
	.art-inner img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* The portrait's face is up top; anchoring top keeps it in frame rather
		   than centring on a shoulder. */
		object-position: center top;
	}
	.art-inner::after {
		/* Readability wash, in the spirit of the template's .live-menu-bg::after.
		   Deliberately uneven: lighter down the left where the artwork's subject
		   sits, heavier to the right and bottom where the dish text is densest. */
		content: '';
		position: absolute;
		inset: 0;
		background:
			linear-gradient(
				100deg,
				color-mix(in srgb, var(--bg) 68%, transparent) 0%,
				color-mix(in srgb, var(--bg) 84%, transparent) 45%,
				color-mix(in srgb, var(--bg) 90%, transparent) 100%
			),
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--bg) 40%, transparent) 0%,
				transparent 22%,
				transparent 72%,
				color-mix(in srgb, var(--bg) 55%, transparent) 100%
			);
	}
	@media (max-width: 720px) {
		/* The artwork is a wide landscape band that FRAMES rather than fills —
		   figure at the left edge, lanterns at the right, empty pale paper through
		   the middle. Cropped to a portrait phone, `cover` zooms into that empty
		   middle and there is literally nothing to see. Anchor left so the geisha
		   is what survives the crop. */
		.art-inner img {
			object-position: 18% center;
		}
		.art-inner::after {
			background: color-mix(in srgb, var(--bg) 80%, transparent);
		}
		/* That flat wash has no light end, so on a phone the band began and ended
		   on a ruled edge — a grey panel switching on under the allergen notice
		   and off again hard against the last dish. Feather both ends into the
		   page. On .art (the full-height box), not .art-inner, so they sit at the
		   real top and bottom of the list rather than riding the sticky panel.
		   The 1px overhang covers the half-pixel row that otherwise shows through
		   as a pale hairline. */
		.art::before,
		.art::after {
			content: '';
			position: absolute;
			left: 0;
			right: 0;
			z-index: 1;
			height: 72px;
		}
		.art::before {
			top: -1px;
			background: linear-gradient(to bottom, var(--bg), transparent);
		}
		.art::after {
			bottom: -1px;
			background: linear-gradient(to top, var(--bg), transparent);
		}
		/* Room for the bottom feather, so it fades empty band and not the last
		   dish's description. */
		.dishes {
			padding-bottom: 1.6rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		/* Sticky reads as parallax; pin it flat instead. */
		.art-inner {
			position: absolute;
			inset: 0;
			height: auto;
		}
	}

	.cat {
		position: relative;
		z-index: 1;
		padding-top: clamp(1.8rem, 3.4vw, 2.8rem);
		scroll-margin-top: 170px;
	}
	.cat-head {
		display: flex;
		align-items: baseline;
		gap: 0.8rem;
		border-bottom: 1px solid var(--line);
		padding-bottom: 0.6rem;
	}
	.cat-head h2 {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: clamp(1.3rem, 2.6vw, 1.7rem);
		margin: 0;
		color: var(--accent);
	}
	.cat-count {
		font-family: var(--font-body);
		font-size: 0.66rem;
		letter-spacing: 0.16em;
		color: var(--ink-faint);
	}
	.cat-note {
		font-family: var(--font-body);
		font-size: 0.82rem;
		font-style: italic;
		line-height: 1.55;
		color: var(--ink-faint);
		margin: 0.7rem 0 0;
		max-width: 78ch;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0 clamp(1.6rem, 4vw, 3.2rem);
	}
	@media (max-width: 820px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.dish {
		padding: 1.1rem 0;
		border-bottom: 1px dashed var(--line);
	}
	.dish-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.9rem;
	}
	.dish-top h3 {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1.02rem;
		line-height: 1.25;
		margin: 0;
		color: var(--ink);
	}
	.price {
		font-family: var(--font-body);
		font-size: 0.9rem;
		font-weight: 500;
		white-space: nowrap;
		color: var(--accent-2);
	}
	.dish-desc {
		font-family: var(--font-body);
		font-size: 0.84rem;
		line-height: 1.55;
		color: var(--ink-soft);
		margin: 0.35rem 0 0;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}
	.pill {
		font-family: var(--font-body);
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border: 1px solid var(--line);
		color: var(--ink-faint);
		padding: 0.2rem 0.5rem;
		border-radius: 10px;
	}
	.pill.spicy {
		border-color: color-mix(in srgb, var(--accent-2) 50%, transparent);
		color: var(--accent-2);
	}
	.pill.fresh {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent);
	}
	@media (max-width: 760px) {
		/* This is the screen the page exists for: read one-handed, at arm's
		   length, in a dim dining room. Type a notch up from the desktop's, where
		   13.4px descriptions and 9px pills were set for a two-column spread. */
		.cat {
			padding-top: 1.7rem;
		}
		/* A long category name ("Sunday à la carte — Fusion Favourites") wraps on
		   a phone. As flex items the count was then flung to the far right of the
		   first line, nowhere near the title it counts. Inline, it simply follows
		   the last word — and one-line headings look exactly as they did. */
		.cat-head {
			display: block;
			text-wrap: balance;
		}
		.cat-head h2 {
			display: inline;
			line-height: 1.25;
		}
		.cat-count {
			margin-left: 0.6rem;
			font-size: 0.75rem;
		}
		.cat-note {
			font-size: 0.86rem;
			/* It ran straight into the first dish name with no more air than
			   separates two lines of the note itself. */
			margin-bottom: 0.35rem;
		}
		.dish {
			padding: 1rem 0;
		}
		.dish-top h3 {
			font-size: 1.08rem;
		}
		.price {
			font-size: 0.95rem;
		}
		.dish-desc {
			font-size: 0.9rem;
		}
		.pill {
			font-size: 0.68rem;
		}
	}
	@media (max-width: 520px) {
		/* Three-or-more-option prices get their own line under the name (see
		   multiPrice in the script). Beside it, "£13.50 / £14.50 / £15.50 /
		   £17.50" took 231 of the row's 342px and stacked "Rendang Malaysian
		   Curry" three words deep in what was left. */
		.dish-top.multi {
			flex-wrap: wrap;
			row-gap: 0.2rem;
		}
		.dish-top.multi .price {
			flex: 1 1 100%;
		}
	}

	.empty {
		font-family: var(--font-body);
		text-align: center;
		color: var(--ink-soft);
		padding: 4rem 1rem;
		font-size: 0.95rem;
	}
	/* Bordered and set in the hot colour so it reads as a notice rather than as
	   more page furniture — it replaced per-dish labelling, so it has to be seen. */
	.allergen-note {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.9rem 1.4rem;
		margin: 0 0 1.8rem;
		padding: 0.9rem 1.2rem;
		border: 1px solid color-mix(in srgb, var(--hot) 40%, transparent);
		border-radius: 10px;
		background: color-mix(in srgb, var(--hot) 7%, transparent);
	}
	.allergen-note p {
		font-family: var(--font-body);
		font-size: 0.86rem;
		line-height: 1.6;
		color: var(--ink-soft);
		margin: 0;
		max-width: 78ch;
	}
	.allergen-note strong {
		color: var(--ink);
	}
	.allergen-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
		font-family: var(--font-body);
		font-size: 0.68rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 0.6rem 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--hot);
		color: var(--hot);
		text-decoration: none;
		transition:
			background 0.22s ease,
			color 0.22s ease;
	}
	.allergen-btn:hover {
		background: var(--hot);
		color: var(--bg);
	}
	.allergen-btn svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
	}
	@media (max-width: 760px) {
		.allergen-note {
			margin: 0.9rem 0 0.4rem;
			padding: 0.85rem 1rem 1rem;
			gap: 0.75rem;
		}
		.allergen-note p {
			font-size: 0.84rem;
			line-height: 1.55;
		}
		/* Wrapped under the text it was a 202px pill adrift at the left of a 342px
		   box. Full width, at a thumb's height, it reads as the box's one action. */
		.allergen-btn {
			flex: 1 1 100%;
			justify-content: center;
			box-sizing: border-box;
			min-height: 44px;
			padding-block: 0;
			font-size: 0.72rem;
		}
	}

	.allergy {
		font-family: var(--font-body);
		font-size: 0.76rem;
		line-height: 1.6;
		color: var(--ink-faint);
		text-align: center;
		margin: 3rem auto 0;
		max-width: 70ch;
		padding-top: 1.6rem;
		border-top: 1px solid var(--line);
	}
	@media (max-width: 720px) {
		/* The dish list now ends in 1.6rem of feathered band (see .art above);
		   3rem more on top of that left the closing line stranded. */
		.allergy {
			margin-top: 1.4rem;
		}
	}
</style>
