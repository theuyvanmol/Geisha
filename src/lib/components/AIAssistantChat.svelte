<script lang="ts">
	// Floating "Ask Geisha" guest assistant. A small chat button bottom-right that
	// opens a panel; messages POST to /api/chat, which grounds Gemini in the
	// brand's admin-editable prompt (menus, allergens, hours…). Themed via the
	// brand's data-brand tokens. Stateless on the server — history is sent each
	// turn from here.
	import type { BrandId } from '$lib/data/brand';
	import { backOut, cubicIn } from 'svelte/easing';
	import AssistantCards from '$lib/components/guest/AssistantCards.svelte';
	import type { Card } from '$lib/components/guest/AssistantCards.svelte';

	// `token` (optional): a self-service booking link token (from /book/[token]).
	// When present it's sent to /api/chat so the assistant can answer about THAT
	// booking (date/time/party/status). Guarded server-side — only a valid,
	// signed token unlocks anything; a bad token is silently ignored.
	let { brand, token }: { brand: BrandId; token?: string } = $props();

	// The panel grows out of the bottom-right corner where the FAB sits
	// (transform-origin set in CSS). Each brand has its OWN character of motion:
	//   · Asia   — the unsheathed blade: a single decisive diagonal cut wipes the
	//              panel open along a katana stroke, with a fast, no-bounce settle.
	//              Precise and controlled, not springy.
	//   · Fusion — a fast, overshooting pop (Western, energetic).
	const panelOpen = $derived(brand === 'asia' ? asiaCut : fusionPop);

	// ASIA — "iaijutsu": the diagonal clip-path sweeps from the top-right corner
	// down to the bottom-left, uncovering the panel like a drawn blade. A subtle
	// shear during the cut, then it snaps square. Easing is sharp-in (fast then
	// hard stop) so it reads as a deliberate strike, never a bounce.
	function asiaCut(_node: HTMLElement) {
		return {
			duration: 440,
			// inverse-cubic feel: very fast travel that decelerates to a clean halt
			easing: (t: number) => 1 - cubicIn(1 - t),
			css: (t: number) => {
				// A diagonal blade-edge `x + y = p` sweeps from the top-left corner
				// across to the bottom-right, uncovering the panel behind it. p runs
				// 0 → 200 (% units) so the whole rectangle clears. The revealed region
				// (x + y ≤ p) is a triangle for the first half of the cut, a pentagon
				// for the second — we build the polygon for whichever phase we're in.
				const p = t * 200;
				const edge = Math.min(100, p); // edge hits top & left at this %
				const far = p - 100; // (2nd phase) edge hits right & bottom at this %
				const clip =
					p <= 100
						? `polygon(0 0, ${edge}% 0, 0 ${edge}%)`
						: `polygon(0 0, 100% 0, 100% ${far}%, ${far}% 100%, 0 100%)`;
				const shear = (1 - t) * 4; // deg of blade-angle skew, settling to 0
				const scale = 0.94 + 0.06 * t; // tight, controlled — no overshoot
				return `
					transform: scale(${scale}) skewX(-${shear}deg);
					opacity: ${Math.min(1, t * 3)};
					clip-path: ${clip};
				`;
			}
		};
	}

	// FUSION — fast overshooting pop. Springs up from the corner and settles.
	function fusionPop(_node: HTMLElement) {
		return {
			duration: 420,
			easing: backOut,
			css: (t: number) => {
				const scale = 0.6 + 0.4 * t;
				const lift = (1 - t) * 34;
				const blur = Math.max(0, (1 - t) * 4);
				return `
					transform: translateY(${lift}px) scale(${scale});
					opacity: ${Math.min(1, t * 1.6)};
					filter: blur(${blur}px);
				`;
			}
		};
	}

	// The FAB springs back in only after the panel has had time to collapse, so
	// the two don't flash over each other. Delay on intro; quick on outro.
	function fabPop(
		_node: HTMLElement,
		_params: undefined,
		{ direction }: { direction: 'in' | 'out' | 'both' }
	) {
		const intro = direction === 'in';
		return {
			duration: intro ? 360 : 140,
			delay: intro ? 180 : 0,
			easing: backOut,
			css: (t: number) => `transform: scale(${0.4 + 0.6 * t}); opacity: ${t};`
		};
	}

	// An assistant message can carry `cards` — the tappable card payloads built
	// from the /api/chat `directives` (show_* UI tools). User messages never do.
	type Msg = { role: 'user' | 'assistant'; content: string; cards?: Card[] };

	// The /api/chat directive shape → card. Only the UI tools' results carry a
	// `kind`; we keep just those (defensive against any non-card directive).
	type Directive = { tool: string; input: unknown; result: unknown };
	function cardsFrom(directives: Directive[] | undefined): Card[] {
		if (!Array.isArray(directives)) return [];
		return directives
			.map((d) => d?.result)
			.filter(
				(r): r is Card =>
					!!r &&
					typeof r === 'object' &&
					'kind' in r &&
					((r as Card).kind === 'availability' ||
						(r as Card).kind === 'dishes' ||
						(r as Card).kind === 'offers')
			);
	}

	// Empty-state quick replies — one tap sends a starter message.
	const QUICK_REPLIES = ['Book a table', 'See the menu', 'Allergen question', "What's on?"];

	let open = $state(false);
	let sending = $state(false);
	let draft = $state('');
	let messages = $state<Msg[]>([]);
	let scroller = $state<HTMLDivElement | null>(null);

	// User-resizable panel. Defaults match the old fixed CSS; the handle in the
	// top-left corner drags to grow the panel up-and-left (it's pinned bottom-
	// right). Clamped to sane bounds and the viewport. null = use CSS default.
	const DEFAULT_W = 360;
	const DEFAULT_H = 540;
	const MIN_W = 300;
	const MIN_H = 360;
	let panelW = $state<number | null>(null);
	let panelH = $state<number | null>(null);

	function startResize(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const startW = panelW ?? DEFAULT_W;
		const startH = panelH ?? DEFAULT_H;
		// drag left/up = bigger, so subtract the delta
		const maxW = Math.min(window.innerWidth - 32, 720);
		const maxH = Math.min(window.innerHeight - 32, 820);
		const onMove = (ev: PointerEvent) => {
			panelW = Math.max(MIN_W, Math.min(maxW, startW - (ev.clientX - startX)));
			panelH = Math.max(MIN_H, Math.min(maxH, startH - (ev.clientY - startY)));
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	const GREETING = $derived(
		brand === 'asia'
			? 'Hi! I’m the Geisha Asia assistant. Ask me about our menus, allergens, opening hours or booking a table.'
			: 'Hi! I’m the Geisha Fusion assistant. Ask me about our menus, allergens, opening hours or booking a table.'
	);

	// Safety net: the panel renders plain text, so if the model still slips any
	// Markdown through, strip the syntax tokens rather than show raw #, ** or ---.
	function plain(text: string): string {
		return text
			.replace(/^[ \t]*#{1,6}[ \t]*/gm, '') // headings
			.replace(/^[ \t]*([-*_])[ \t]*\1[ \t]*\1[ \t]*$/gm, '') // --- *** ___ rules
			.replace(/\*\*([^*]+)\*\*/g, '$1') // bold
			.replace(/(?<!\*)\*(?!\*)([^*\n]+)\*/g, '$1') // italics
			.replace(/^[ \t]*[-*+][ \t]+/gm, '• ') // bullets → simple dot
			.replace(/\n{3,}/g, '\n\n') // collapse big gaps
			.trim();
	}

	function toggle() {
		open = !open;
	}

	// Reset the conversation back to the greeting + quick replies. The server is
	// stateless (history is sent from here each turn), so clearing the local list
	// is a full reset — nothing to tell the server.
	function clearChat() {
		if (sending) return;
		messages = [];
		draft = '';
	}

	function scrollToEnd() {
		// after the DOM updates
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	}

	// Send a starter from the empty-state quick replies.
	function quickReply(text: string) {
		if (sending) return;
		draft = text;
		send();
	}

	async function send() {
		const text = draft.trim();
		if (!text || sending) return;
		draft = '';
		messages = [...messages, { role: 'user', content: text }];
		sending = true;
		scrollToEnd();

		try {
			// send prior turns (exclude the just-added user msg, server adds it)
			const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ brand, message: text, history, bookingToken: token })
			});
			const data = (await res.json().catch(() => null)) as {
				answer?: string;
				directives?: Directive[];
			} | null;
			const answer =
				data?.answer ?? 'Sorry — something went wrong. Please try again, or give us a call.';
			// Attach any show_* cards to this assistant turn, rendered below the bubble.
			const cards = cardsFrom(data?.directives);
			messages = [
				...messages,
				{ role: 'assistant', content: answer, ...(cards.length ? { cards } : {}) }
			];
		} catch {
			messages = [
				...messages,
				{ role: 'assistant', content: 'Sorry — I couldn’t reach the assistant. Please try again.' }
			];
		} finally {
			sending = false;
			scrollToEnd();
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="assistant" data-brand={brand}>
	{#if open}
		<section
			class="panel"
			aria-label="Geisha guest assistant"
			transition:panelOpen
			style:width={panelW ? `${panelW}px` : null}
			style:height={panelH ? `${panelH}px` : null}
		>
			<div
				class="resize-handle"
				role="separator"
				aria-label="Resize chat"
				aria-orientation="horizontal"
				onpointerdown={startResize}
				title="Drag to resize"
			></div>
			<header class="head">
				<span class="title">Ask Geisha</span>
				{#if messages.length > 0}
					<button
						class="clear"
						onclick={clearChat}
						disabled={sending}
						aria-label="Clear conversation"
						title="Clear conversation">Clear</button
					>
				{/if}
				<button class="close" onclick={toggle} aria-label="Close chat">✕</button>
			</header>

			<div class="log" bind:this={scroller}>
				<div class="bubble bot">{GREETING}</div>
				{#if messages.length === 0}
					<div class="quick-replies">
						{#each QUICK_REPLIES as q (q)}
							<button type="button" class="quick" onclick={() => quickReply(q)}>{q}</button>
						{/each}
					</div>
				{/if}
				{#each messages as m}
					<div class="bubble {m.role === 'user' ? 'me' : 'bot'}">
						{m.role === 'assistant' ? plain(m.content) : m.content}
					</div>
					{#if m.role === 'assistant' && m.cards && m.cards.length}
						<AssistantCards cards={m.cards} />
					{/if}
				{/each}
				{#if sending}
					<div class="bubble bot typing"><span></span><span></span><span></span></div>
				{/if}
			</div>

			<div class="composer">
				<textarea
					bind:value={draft}
					onkeydown={onKey}
					rows="1"
					placeholder="Type your question…"
					aria-label="Your message"
				></textarea>
				<button class="send" onclick={send} disabled={sending || !draft.trim()} aria-label="Send">
					→
				</button>
			</div>
			<p class="disclaimer">AI assistant — for allergies always confirm with staff.</p>
		</section>
	{/if}

	{#if !open}
		<button class="fab" onclick={toggle} aria-label="Open guest assistant" transition:fabPop>
			<span class="fab-icon" aria-hidden="true">◆</span>
			<span class="fab-label">Ask Geisha</span>
		</button>
	{/if}
</div>

<style>
	.assistant {
		position: fixed;
		right: 1.4rem;
		bottom: 1.4rem;
		z-index: 95;
		/* --font-body / --font-display, never --font-sans / --font-serif (see the rule
		   of thumb in tokens.css). Those two resolve to Space Grotesk and Cormorant,
		   which most Fusion pages no longer load — so Fusion's panel was setting its
		   title in fallback Georgia and its messages in the system sans. Asia is
		   unaffected: its block below names its faces outright. */
		font-family: var(--font-body);
	}
	/* Pin both the FAB and the panel to the same bottom-right corner so swapping
	   one for the other never shifts layout — the panel grows out of, and
	   collapses back into, the exact spot the button occupies. */
	.assistant .fab,
	.assistant .panel {
		position: absolute;
		right: 0;
		bottom: 0;
	}
	/* This used to lift 4.6rem (Fusion) / 5.6rem (Asia) to clear a persistent bottom
	   bar — Fusion's StickyCTA and Asia's centred floating pill. Both components are
	   gone, so the lift was clearing nothing and instead parked a 50px button in the
	   middle-right of the screen, on top of live content: it covered body copy in
	   Asia's "Our Story" and overlapped the "View the Menu" hero CTA on Fusion by
	   8px. Sit it back in the corner where a FAB belongs. */
	@media (max-width: 760px) {
		.assistant {
			right: 0.9rem;
			bottom: calc(0.9rem + env(safe-area-inset-bottom, 0px));
			transition: translate 0.5s cubic-bezier(0.22, 0.9, 0.3, 1);
		}
		/* FIRST VISIT. The cookie notice (z 10000) is fixed over this corner, so the
		   button was simply painted underneath it — there, focusable, and invisible.
		   Lifting it clear by `--cb-h` (the notice's height, published on <html> by
		   CookieBanner, unset once it is answered) was tried and is worse: the home
		   heroes lift their copy and buttons above the notice too, and the button
		   lands on the end of them (10px into Fusion's "View the Menu" at 390 wide).
		   So the button waits its turn instead — parked a notice-height
		   below the screen edge while the notice is up, sliding into its corner when
		   it goes. On the WRAPPER, not the button: Asia's button already animates its
		   own `translate` on hover. And not while the panel is open — re-opening the
		   notice from "Cookie Settings" must not drag an open chat off the screen.
		   (`--cb-park`, not `--cb-h`: on a phone the notice is a slim strip that no
		   longer moves the page, so `--cb-h` is unset there — but it still covers
		   this corner. The strip is barely taller than the button, hence the extra
		   1rem to clear the edge; the -1rem fallback cancels it when there is no
		   notice, so the button rests exactly in its corner.) */
		.assistant:not(:has(.panel)) {
			translate: 0 calc(var(--cb-park, -1rem) + 1rem);
		}
	}
	@media (max-width: 760px) and (prefers-reduced-motion: reduce) {
		.assistant {
			transition: none;
		}
	}

	/* Floating button */
	.fab {
		display: inline-flex;
		align-items: center;
		/* The FAB is absolutely positioned inside a shrink-to-fit box, so its own
		   available width resolves to zero and the label breaks at every space
		   ("Ask / Geisha") unless it is told not to. */
		white-space: nowrap;
		gap: 0.55rem;
		padding: 0.75rem 1.1rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--accent);
		color: var(--bg);
		font-family: var(--font-body);
		font-size: 0.78rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		font-weight: 600;
		cursor: pointer;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease;
		transform-origin: bottom right;
	}
	.fab:hover {
		transform: translateY(-2px);
		box-shadow: 0 12px 34px rgba(0, 0, 0, 0.34);
	}
	.fab-icon {
		font-size: 1rem;
		line-height: 1;
	}
	/* Below the tablet breakpoint the labelled pill is wide enough to sit on top of
	   hero CTAs and card text. Collapse it to a compact round icon button so it
	   intrudes as little as possible while still being a clear 48px touch target. */
	@media (max-width: 760px) {
		.fab-label {
			display: none;
		}
		.fab {
			padding: 0;
			width: 50px;
			height: 50px;
			justify-content: center;
		}
		.fab-icon {
			font-size: 1.15rem;
		}
	}

	/* Panel */
	.panel {
		display: flex;
		flex-direction: column;
		width: min(92vw, 360px);
		height: min(72vh, 540px);
		background: color-mix(in srgb, var(--bg) 94%, transparent);
		backdrop-filter: blur(14px) saturate(120%);
		-webkit-backdrop-filter: blur(14px) saturate(120%);
		border: 1px solid var(--line);
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
		color: var(--ink);
		transform-origin: bottom right;
		position: relative;
	}
	/* Drag-to-resize grip, top-left corner (panel is pinned bottom-right, so it
	   grows up-and-left). A small diagonal grab area with a subtle corner mark. */
	.resize-handle {
		position: absolute;
		top: 0;
		left: 0;
		width: 22px;
		height: 22px;
		cursor: nwse-resize;
		z-index: 2;
		touch-action: none;
	}
	.resize-handle::before {
		content: '';
		position: absolute;
		top: 6px;
		left: 6px;
		width: 9px;
		height: 9px;
		border-top: 2px solid var(--ink-faint);
		border-left: 2px solid var(--ink-faint);
		border-top-left-radius: 4px;
		opacity: 0.55;
		transition:
			opacity 0.18s ease,
			border-color 0.18s ease;
	}
	.resize-handle:hover::before {
		opacity: 1;
		border-color: var(--accent);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid var(--line);
	}
	.title {
		font-family: var(--font-display);
		font-size: 1.2rem;
		color: var(--ink);
		flex: 1;
	}
	.clear {
		background: none;
		border: 1px solid var(--line);
		color: var(--ink-soft);
		font-family: var(--font-body);
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 0.28rem 0.6rem;
		margin-right: 0.4rem;
		border-radius: 999px;
		cursor: pointer;
		transition:
			color 0.2s ease,
			border-color 0.2s ease,
			background 0.2s ease;
	}
	.clear:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--accent);
	}
	.clear:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.7rem;
		height: 1.7rem;
		background: none;
		border: 0;
		color: var(--ink-soft);
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
		border-radius: 50%;
		transition:
			color 0.2s ease,
			background 0.2s ease,
			transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.close:hover {
		color: var(--ink);
		background: color-mix(in srgb, var(--ink) 10%, transparent);
		transform: rotate(90deg) scale(1.08);
	}
	.close:active {
		transform: rotate(90deg) scale(0.92);
	}

	.log {
		flex: 1;
		overflow-y: auto;
		padding: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.bubble {
		max-width: 85%;
		padding: 0.6rem 0.8rem;
		border-radius: 14px;
		font-size: 0.86rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-wrap: break-word;
	}
	.bubble.bot {
		align-self: flex-start;
		background: var(--card);
		border: 1px solid var(--line);
		color: var(--ink);
		border-bottom-left-radius: 4px;
	}
	.bubble.me {
		align-self: flex-end;
		background: var(--accent);
		color: var(--bg);
		border-bottom-right-radius: 4px;
	}

	/* empty-state quick replies */
	.quick-replies {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-self: flex-start;
		max-width: 92%;
	}
	.quick {
		font-family: var(--font-body);
		font-size: 0.76rem;
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		color: var(--accent);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			transform 0.12s ease;
	}
	.quick:hover {
		background: var(--accent);
		color: var(--bg);
		transform: translateY(-1px);
	}

	/* typing dots */
	.typing {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
	}
	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-faint);
		animation: blink 1.2s infinite ease-in-out both;
	}
	.typing span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.typing span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes blink {
		0%,
		80%,
		100% {
			opacity: 0.25;
		}
		40% {
			opacity: 1;
		}
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
		padding: 0.7rem;
		border-top: 1px solid var(--line);
	}
	textarea {
		flex: 1;
		resize: none;
		max-height: 6rem;
		font: inherit;
		font-size: 0.86rem;
		line-height: 1.4;
		padding: 0.55rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		color: var(--ink);
	}
	textarea::placeholder {
		color: var(--ink-faint);
	}
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.send {
		flex: 0 0 auto;
		width: 2.4rem;
		height: 2.4rem;
		border: 0;
		border-radius: 10px;
		background: var(--accent);
		color: var(--bg);
		font-size: 1.1rem;
		cursor: pointer;
		transition: opacity 0.15s ease;
	}
	.send:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.disclaimer {
		margin: 0;
		padding: 0 0.9rem 0.7rem;
		font-size: 0.66rem;
		color: var(--ink-faint);
		text-align: center;
	}

	/* ===== ASIA — the 2026 redesign language =====
	   Scoped to [data-brand='asia'] so Fusion keeps its own (token-driven) look.
	   Ink grounds under gold hairlines, square edges, Shippori Mincho display over
	   spaced Jost, and sakura for anything actionable — the home page's kit. */
	/* ===== "Ask Geisha" button — redesign language =====
	   Was a rounded cream-and-gold pill from the pre-redesign palette. Now the
	   same object as the hero and nav buttons: a SQUARE ink tile behind a gold
	   hairline, spaced Jost caps, a sakura pip for the mark — and the same hover
	   as those buttons, sakura ink rising from the bottom edge under a single
	   sheen. Tokens are restated here because this component sits outside the
	   Asia page's own scope. */
	.assistant[data-brand='asia'] .fab {
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--gold: #d4af37;
		--ivory: #f5f1e8;
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);
		gap: 0.75rem;
		padding: 14px 22px;
		border: 1px solid rgba(212, 175, 55, 0.45);
		border-radius: 0;
		background: rgba(10, 9, 8, 0.82);
		backdrop-filter: blur(12px) saturate(120%);
		-webkit-backdrop-filter: blur(12px) saturate(120%);
		color: var(--ivory);
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.66rem;
		font-weight: 400;
		letter-spacing: 0.24em;
		overflow: hidden;
		z-index: 0;
		box-shadow: 0 14px 34px -12px rgba(0, 0, 0, 0.7);
		/* The lift uses `translate:`, not `transform:` — the entry pop (fabPop)
		   animates inline `transform`, and the two would fight over the property. */
		translate: 0 0;
		transition:
			color 0.45s var(--ease),
			border-color 0.45s var(--ease),
			translate 0.5s var(--ease),
			box-shadow 0.5s var(--ease);
	}
	/* Rising ink, curved along its leading edge until it lands. */
	.assistant[data-brand='asia'] .fab::before {
		content: '';
		position: absolute;
		left: -8%;
		right: -8%;
		bottom: 0;
		height: 100%;
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		border-radius: 46% 46% 0 0 / 22px 22px 0 0;
		transform: translateY(103%);
		transition:
			transform 0.6s var(--ease),
			border-radius 0.6s var(--ease);
		z-index: -1;
	}
	/* One-shot glint, fired on hover rather than parked at rest. */
	.assistant[data-brand='asia'] .fab::after {
		content: '';
		position: absolute;
		top: -60%;
		bottom: -60%;
		left: 0;
		width: 22%;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
		transform: translateX(-160%) skewX(-18deg);
		opacity: 0;
		z-index: -1;
	}
	.assistant[data-brand='asia'] .fab:hover,
	.assistant[data-brand='asia'] .fab:focus-visible {
		color: #fff;
		border-color: var(--sakura-2);
		transform: none; /* cancels the shared rule's lift; this one uses translate */
		translate: 0 -3px;
		box-shadow: 0 20px 40px -14px rgba(239, 60, 92, 0.5);
	}
	.assistant[data-brand='asia'] .fab:hover::before,
	.assistant[data-brand='asia'] .fab:focus-visible::before {
		transform: translateY(0);
		border-radius: 0;
	}
	.assistant[data-brand='asia'] .fab:hover::after,
	.assistant[data-brand='asia'] .fab:focus-visible::after {
		animation: fab-sheen 0.9s var(--ease) 0.15s;
	}
	.assistant[data-brand='asia'] .fab:active {
		translate: 0 -1px;
		transition-duration: 0.12s;
	}
	@keyframes fab-sheen {
		0% {
			opacity: 0;
			transform: translateX(-160%) skewX(-18deg);
		}
		15%,
		85% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translateX(600%) skewX(-18deg);
		}
	}
	/* The pip: the redesign's rotated-square accent mark, in sakura. */
	.assistant[data-brand='asia'] .fab-icon {
		color: var(--sakura);
		font-size: 0.5rem;
		line-height: 1;
		text-shadow: 0 0 12px rgba(239, 60, 92, 0.6);
		transition: color 0.45s var(--ease);
	}
	.assistant[data-brand='asia'] .fab:hover .fab-icon,
	.assistant[data-brand='asia'] .fab:focus-visible .fab-icon {
		color: #fff;
		text-shadow: none;
	}
	.assistant[data-brand='asia'] .fab-label {
		font-family: 'Jost', system-ui, sans-serif;
		letter-spacing: 0.24em;
	}
	/* Collapsed to an icon under 760px (see the base rule) — square, not round,
	   and the pip grows to carry the tile on its own. */
	@media (max-width: 760px) {
		.assistant[data-brand='asia'] .fab {
			width: 52px;
			height: 52px;
			padding: 0;
		}
		.assistant[data-brand='asia'] .fab-icon {
			font-size: 1.05rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.assistant[data-brand='asia'] .fab:hover,
		.assistant[data-brand='asia'] .fab:focus-visible,
		.assistant[data-brand='asia'] .fab:active {
			translate: none;
		}
		.assistant[data-brand='asia'] .fab::before {
			transform: none;
			border-radius: 0;
			opacity: 0;
			transition: opacity 0.2s linear;
		}
		.assistant[data-brand='asia'] .fab:hover::before,
		.assistant[data-brand='asia'] .fab:focus-visible::before {
			opacity: 1;
		}
		.assistant[data-brand='asia'] .fab:hover::after,
		.assistant[data-brand='asia'] .fab:focus-visible::after {
			animation: none;
		}
	}

	/* The panel is the same object as the "Ask Geisha" tile it grows out of: an ink
	   slab behind a gold hairline, square-cornered, no radius anywhere. `color-scheme`
	   makes the textarea's caret and the log's scrollbar render dark to match. */
	.assistant[data-brand='asia'] .panel {
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--gold: #d4af37;
		--ivory: #f5f1e8;
		--muted: #a3a0a0;
		--hair: rgba(255, 255, 255, 0.12);
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);
		color-scheme: dark;
		background: rgba(10, 9, 8, 0.86);
		backdrop-filter: blur(16px) saturate(120%);
		-webkit-backdrop-filter: blur(16px) saturate(120%);
		border: 1px solid rgba(212, 175, 55, 0.45);
		border-radius: 0;
		color: var(--ivory);
		font-family: 'Jost', system-ui, sans-serif;
		box-shadow: 0 26px 70px -18px rgba(0, 0, 0, 0.8);
	}
	.assistant[data-brand='asia'] .resize-handle::before {
		border-top-color: rgba(212, 175, 55, 0.5);
		border-left-color: rgba(212, 175, 55, 0.5);
		border-top-left-radius: 0;
	}
	.assistant[data-brand='asia'] .resize-handle:hover::before {
		border-top-color: var(--sakura-2);
		border-left-color: var(--sakura-2);
	}
	.assistant[data-brand='asia'] .head {
		padding: 1rem 1.1rem 0.9rem;
		border-bottom: 1px solid var(--hair);
	}
	/* Display serif behind the section-eyebrow's gold rule — the same pairing the
	   home page uses for "Our Story", at panel scale. */
	.assistant[data-brand='asia'] .title {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		font-family: 'Shippori Mincho', Georgia, 'Times New Roman', serif;
		font-weight: 600;
		font-size: 1.1rem;
		letter-spacing: 0.01em;
		color: var(--ivory);
	}
	.assistant[data-brand='asia'] .title::before {
		content: '';
		flex: none;
		width: 26px;
		height: 1px;
		background: var(--gold);
	}
	.assistant[data-brand='asia'] .close {
		color: var(--muted);
		border-radius: 0;
	}
	.assistant[data-brand='asia'] .close:hover {
		color: #fff;
		background: transparent;
	}
	.assistant[data-brand='asia'] .clear {
		border-radius: 0;
		border-color: rgba(212, 175, 55, 0.4);
		color: var(--muted);
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.58rem;
		letter-spacing: 0.2em;
	}
	.assistant[data-brand='asia'] .clear:hover:not(:disabled) {
		color: var(--ivory);
		border-color: var(--sakura-2);
	}
	.assistant[data-brand='asia'] .log {
		padding: 1.1rem;
		gap: 0.75rem;
		scrollbar-width: thin;
		scrollbar-color: rgba(212, 175, 55, 0.35) transparent;
	}
	.assistant[data-brand='asia'] .bubble {
		border-radius: 0;
		font-size: 0.85rem;
		line-height: 1.62;
		padding: 0.7rem 0.9rem;
	}
	/* The reply carries a gold rule down its leading edge, the way the home page's
	   eyebrows and framed stills are held by a single hairline. */
	.assistant[data-brand='asia'] .bubble.bot {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--hair);
		border-left: 1px solid rgba(212, 175, 55, 0.55);
		color: rgba(245, 241, 232, 0.92);
	}
	.assistant[data-brand='asia'] .bubble.me {
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		color: #fff;
		border: 0;
	}
	/* Starters are the hero's buttons at chip scale: spaced caps behind a gold
	   hairline, sakura ink on hover. */
	.assistant[data-brand='asia'] .quick {
		padding: 0.55rem 0.9rem;
		border-radius: 0;
		border-color: rgba(212, 175, 55, 0.45);
		background: transparent;
		color: var(--ivory);
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.62rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		transition:
			background 0.45s var(--ease),
			border-color 0.45s var(--ease),
			color 0.45s var(--ease),
			transform 0.4s var(--ease);
	}
	.assistant[data-brand='asia'] .quick:hover {
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		border-color: var(--sakura-2);
		color: #fff;
		transform: translateY(-2px);
	}
	.assistant[data-brand='asia'] .typing span {
		background: var(--sakura);
	}
	.assistant[data-brand='asia'] .composer {
		padding: 0.85rem;
		border-top: 1px solid var(--hair);
	}
	.assistant[data-brand='asia'] textarea {
		border-radius: 0;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--hair);
		color: var(--ivory);
		font-family: 'Jost', system-ui, sans-serif;
		padding: 0.65rem 0.8rem;
	}
	.assistant[data-brand='asia'] textarea::placeholder {
		color: var(--muted);
	}
	.assistant[data-brand='asia'] textarea:focus {
		border-color: var(--sakura);
	}
	.assistant[data-brand='asia'] .send {
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 0;
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		color: #fff;
		transition:
			opacity 0.15s ease,
			box-shadow 0.45s var(--ease);
	}
	.assistant[data-brand='asia'] .send:not(:disabled):hover {
		box-shadow: 0 12px 26px -10px rgba(239, 60, 92, 0.7);
	}
	.assistant[data-brand='asia'] .disclaimer {
		padding: 0 1.1rem 0.9rem;
		font-size: 0.56rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	/* ===== PHONES — both brands =====
	   Last in the file and written against `.assistant[data-brand]` so it lands on
	   Fusion's base rules and on Asia's `[data-brand='asia']` block alike (equal
	   specificity, later in source). */
	@media (max-width: 760px) {
		/* iOS zooms the whole page in when a focused field's text is under 16px,
		   and doesn't zoom back out — the panel ends up half off screen. */
		.assistant[data-brand] textarea {
			font-size: 16px;
		}
		/* 27px and 38–42px controls. The glyphs stay where they were: the close
		   button grows into the header's padding on negative margins. */
		.assistant[data-brand] .close {
			width: 2.75rem;
			height: 2.75rem;
			margin: -0.5rem -0.5rem -0.5rem 0;
		}
		.assistant[data-brand] .send {
			width: 2.75rem;
			height: 2.75rem;
		}
		/* The starters were 31–34px tall. */
		.assistant[data-brand] .quick-replies {
			max-width: 100%;
			gap: 0.5rem;
		}
		.assistant[data-brand] .quick {
			display: inline-flex;
			align-items: center;
			min-height: 40px;
		}
		/* Asia's are spaced caps at 9.9px; 11.5px is as large as they go while the
		   four still pair up two to a row at 360 wide. */
		.assistant[data-brand='asia'] .quick {
			padding: 0 0.8rem;
			font-size: 0.72rem;
			letter-spacing: 0.16em;
		}
		/* The one line here that matters for safety was the smallest text on the
		   site: 9px tracked caps on Asia, breaking with "STAFF." orphaned on a second
		   line. Sentence case at 11.5px reads, and fits on one. */
		.assistant[data-brand] .disclaimer {
			font-size: 0.72rem;
			letter-spacing: 0.02em;
			text-transform: none;
		}
		/* Drag-to-resize is a mouse affordance: on a phone the panel already fills
		   the width, and the grip just reads as a stray mark beside the title. */
		.assistant[data-brand] .resize-handle {
			display: none;
		}
	}
</style>
