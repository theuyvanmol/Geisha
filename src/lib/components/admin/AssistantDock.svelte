<script lang="ts">
	// Persistent collapsible admin-assistant dock (WP-S6-5).
	//
	// Mounted ONCE in the admin shell's named assistant-dock region, so it
	// survives client-side navigation. It binds entirely to the shared rune
	// store (src/lib/admin/assistant.svelte.ts) — the conversation, the proposed
	// write, and the open setting widgets are the SAME state the full-page
	// /admin/assistant view and the Cmd/Ctrl-K command bar use. Collapsed it is a
	// pill button; expanded it is a compact chat with the confirm card + setting
	// widgets inline. Styled only with --admin-* tokens (admin.css).
	import { assistant, CONFIRM_WORD } from '$lib/admin/assistant.svelte';
	import SettingWidget from '../../../routes/admin/assistant/SettingWidget.svelte';
	import ContentWidget from './ContentWidget.svelte';
	import AssistantResultCard from './AssistantResultCard.svelte';
	import AssistantMarkdown from './AssistantMarkdown.svelte';
	// WP-S6-7 — Voice V1 (additive). All client-side + feature-detected; the mic
	// and mute controls below only render when the Web Speech API is present.
	import { onDestroy } from 'svelte';
	import {
		isVoiceSupported,
		isSpeechSupported,
		startDictation,
		speak,
		cancelSpeech,
		isVoiceEnabled,
		setVoiceEnabled
	} from '$lib/admin/voice';

	let scroller = $state<HTMLDivElement | null>(null);
	let textarea = $state<HTMLTextAreaElement | null>(null);
	let lastFocusReq = 0;

	// --- Voice (WP-S6-7) -----------------------------------------------------
	// Computed once on the client; false during SSR so nothing voice renders on
	// the server. `voiceSupported` gates the mic (needs STT + TTS); `ttsSupported`
	// gates the mute toggle (TTS alone).
	const voiceSupported = isVoiceSupported();
	const ttsSupported = isSpeechSupported();
	let voiceEnabled = $state(true); // spoken-readback toggle, hydrated below
	let listening = $state(false);
	let stopDictation: (() => void) | null = null;
	// When a typed message is sent while the mic is live, we stop dictation but must
	// SUPPRESS its onFinal auto-send — otherwise the captured transcript would fire a
	// second, duplicate request right after the typed one. Set just before we tear
	// the recogniser down for a manual send.
	let suppressNextFinal = false;

	$effect(() => {
		// Hydrate the persisted mute preference on the client only.
		voiceEnabled = isVoiceEnabled();
	});

	function scrollDown() {
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = scroller.scrollHeight;
		});
	}

	// Auto-scroll when the conversation grows or a confirm card appears.
	$effect(() => {
		// touch the reactive deps
		assistant.messages.length;
		assistant.loading;
		assistant.proposed;
		if (assistant.dockOpen) scrollDown();
	});

	// Cmd/Ctrl-K (and the command-bar) bump focusRequest; grab the composer when
	// it changes while the dock is open.
	$effect(() => {
		const req = assistant.focusRequest;
		if (req !== lastFocusReq) {
			lastFocusReq = req;
			if (assistant.dockOpen) requestAnimationFrame(() => textarea?.focus());
		}
	});

	// Single entry point for every TYPED send (Enter, the Send button, a chip).
	// Always tears down a live mic first so sending a message also stops the
	// recording — and suppresses the dictation auto-send so the typed text is the
	// only request that goes out.
	function submitDraft(text: string) {
		if (listening) cancelMic();
		assistant.send(text);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submitDraft(assistant.draft);
		}
	}

	// --- Voice send + readback (WP-S6-7) -------------------------------------
	// A spoken request is sent via the SAME store.send() the text path uses (it
	// echoes {voice:true} to the API). When it resolves we read back the result:
	//  · a proposed WRITE → speak only the human summary + a confirm cue, and
	//    leave the confirm card as the SOLE way to apply it (never auto-confirm).
	//  · otherwise → speak the plain answer.
	// Reading raw JSON or the DESTRUCTIVE prefix is avoided by speaking
	// assistant.summarise()/the answer text, never proposed.input.
	async function sendVoice(text: string) {
		await assistant.send(text, { voice: true });
		if (!voiceEnabled || !ttsSupported) return;
		if (assistant.proposed) {
			speak(`I'd like to ${assistant.summarise(assistant.proposed)}. Please confirm to apply.`);
		} else {
			const last = assistant.messages[assistant.messages.length - 1];
			if (last?.role === 'assistant') speak(last.content);
		}
	}

	// Tap-to-toggle mic. Tap once to start dictating, tap again to stop and send —
	// more predictable than press-and-hold (a release that lands off the button,
	// or a flaky pointerup, used to leave it stuck "listening" with no way to tap
	// it off). Interim transcripts stream into the shared draft; stopping settles
	// via the dictation onFinal, which sends and triggers the readback. The engine
	// also self-ends on silence/no-speech/error → onFinal, which clears `listening`
	// so the button never gets wedged on.
	function startMic() {
		if (!voiceSupported || assistant.loading || listening) return;
		cancelSpeech(); // talking again silences any in-flight readback
		listening = true;
		assistant.draft = '';
		stopDictation = startDictation(
			(interim) => {
				assistant.draft = interim;
			},
			(final) => {
				// Fires on manual stop AND on engine end/error — the single place we
				// leave the listening state, so the mic can't stay stuck on.
				listening = false;
				stopDictation = null;
				// A typed send already tore us down and is sending its own text; don't
				// fire a duplicate voice request off whatever we'd captured.
				if (suppressNextFinal) {
					suppressNextFinal = false;
					return;
				}
				if (final) sendVoice(final);
			}
		);
	}

	// Stop a live mic WITHOUT sending its transcript — used when a typed message
	// takes over. Tears the recogniser down and swallows the pending onFinal send.
	function cancelMic() {
		if (!listening && !stopDictation) return;
		suppressNextFinal = true;
		const stop = stopDictation;
		stopDictation = null;
		listening = false;
		try {
			stop?.();
		} catch {
			/* already stopped */
		}
	}

	function stopMic() {
		// Settle immediately so the UI flips off even if the engine's onend lags;
		// onFinal will still fire and send. Guard against a double-clear.
		if (!listening) return;
		const stop = stopDictation;
		stopDictation = null;
		listening = false;
		try {
			stop?.(); // → onFinal → sendVoice()
		} catch {
			/* already stopped */
		}
	}

	function toggleMic() {
		if (listening) stopMic();
		else startMic();
	}

	function toggleVoice() {
		voiceEnabled = !voiceEnabled;
		setVoiceEnabled(voiceEnabled); // persists + cancels speech when muting
	}

	onDestroy(() => {
		stopDictation?.();
		cancelSpeech();
	});
</script>

<div class="dock" class:open={assistant.dockOpen}>
	{#if assistant.dockOpen}
		<section class="panel" aria-label="Admin assistant">
			<header class="head">
				<span class="title">Assistant</span>
				{#if ttsSupported}
					<button
						class="voicetoggle"
						type="button"
						onclick={toggleVoice}
						aria-pressed={voiceEnabled}
						title={voiceEnabled ? 'Mute spoken replies' : 'Unmute spoken replies'}
						aria-label={voiceEnabled ? 'Mute spoken replies' : 'Unmute spoken replies'}
					>
						{voiceEnabled ? '🔊' : '🔇'}
					</button>
				{/if}
				<a class="expand" href="/admin/assistant" title="Open full assistant">Expand</a>
				<button
					class="collapse"
					type="button"
					onclick={() => assistant.toggleDock()}
					aria-label="Collapse assistant"
				>
					✕
				</button>
			</header>

			{#if !assistant.configured}
				<p class="notice">
					AI not switched on yet — add an AI Gateway key in Settings → Integrations.
				</p>
			{/if}

			<div class="log" bind:this={scroller}>
				{#if assistant.messages.length === 0}
					<div class="empty">
						Ask me to find space for a party, seat a walk-in, rearrange the floor, or change a
						setting.
					</div>
					<!-- admin-onboarding: one-tap "Explain this page" — asks the assistant to
					     walk the operator through whatever page they're on (calls explain_page
					     server-side). Handy for a new host who isn't sure what they're looking at. -->
					<button
						class="explain"
						type="button"
						onclick={() =>
							submitDraft(`Explain the ${assistant.pageLabel} page and how to use it.`)}
						disabled={assistant.loading}
					>
						Explain this page
					</button>
					<!-- Page-aware starter chips: things the assistant can do on THIS page
					     (e.g. "Move a party" on the floor, "Add a table" in the editor). -->
					{#if assistant.suggestions.length > 0}
						<div class="chips" aria-label="Suggested actions for this page">
							<p class="chips-label">On {assistant.pageLabel}, try:</p>
							{#each assistant.suggestions as s}
								<button
									class="chip"
									type="button"
									onclick={() => submitDraft(s.prompt)}
									disabled={assistant.loading}
								>
									{s.label}
								</button>
							{/each}
						</div>
					{/if}
				{/if}

				{#each assistant.messages as m}
					<div class="bubble {m.role}">
						{#if m.role === 'assistant'}
							<AssistantMarkdown text={m.content} />
						{:else}
							{m.content}
						{/if}
					</div>
				{/each}

				{#if assistant.loading}
					<div class="bubble assistant typing"><span></span><span></span><span></span></div>
				{/if}

				{#if assistant.planLoading}
					<div class="plan-loading">Planning tonight…</div>
				{/if}

				{#if assistant.planError}
					<div class="plan-error" role="status">{assistant.planError}</div>
				{/if}

				{#if assistant.eveningPlan}
					{@const plan = assistant.eveningPlan}
					{@const st = assistant.planStatus}
					{@const firable = plan.items.filter((i) => i.action)}
					{@const pendingCount = firable.filter(
						(i) => st[i.id] !== 'applied' && st[i.id] !== 'skipped'
					).length}
					<div class="plan" aria-label="Evening plan">
						<header class="plan-head">
							<p class="plan-title">Plan for tonight</p>
							<button
								class="plan-x"
								type="button"
								onclick={() => assistant.dismissPlan()}
								aria-label="Close plan">✕</button
							>
						</header>
						<p class="plan-headline">{plan.headline}</p>
						{#if plan.narration}
							<p class="plan-narration">{plan.narration}</p>
						{/if}

						{#if plan.items.length === 0}
							<p class="plan-empty">
								Nothing to action — the room is set and no covers need chasing.
							</p>
						{:else}
							<ul class="plan-items">
								{#each plan.items as item (item.id)}
									{@const status = st[item.id] ?? 'pending'}
									<li
										class="plan-item {item.kind}"
										class:done={status === 'applied' || status === 'skipped'}
									>
										<div class="pi-main">
											<span class="pi-tag {item.kind}">{item.kind}</span>
											<div class="pi-text">
												<p class="pi-title">{item.title}</p>
												<p class="pi-detail">{item.detail}</p>
											</div>
										</div>
										<div class="pi-actions">
											{#if status === 'applied'}
												<span class="pi-state ok"
													>{item.actionKind === 'read' ? 'Drafted' : 'Applied'} ✓</span
												>
											{:else if status === 'skipped'}
												<span class="pi-state muted">Skipped</span>
											{:else if status === 'failed'}
												<span class="pi-state bad">Failed</span>
												{#if item.action}
													<button class="pi-apply" onclick={() => assistant.applyPlanItem(item)}
														>Retry</button
													>
												{/if}
											{:else if item.action}
												<button
													class="pi-apply"
													onclick={() => assistant.applyPlanItem(item)}
													disabled={status === 'busy'}
												>
													{status === 'busy' ? '…' : item.actionKind === 'read' ? 'Draft' : 'Apply'}
												</button>
												<button
													class="pi-skip"
													onclick={() => assistant.skipPlanItem(item)}
													disabled={status === 'busy'}>Skip</button
												>
											{:else if item.link}
												<a class="pi-link" href={item.link}>Open</a>
											{/if}
										</div>
									</li>
								{/each}
							</ul>

							{#if pendingCount > 0}
								<div class="plan-foot">
									<button class="plan-approve-all" onclick={() => assistant.approveAllPlan()}>
										Approve all ({pendingCount})
									</button>
									<span class="plan-note">Each fires its own confirmed action.</span>
								</div>
							{/if}
						{/if}
					</div>
				{/if}

				{#if assistant.proposed}
					{@const destructive = assistant.confirmStrength === 'type'}
					<div class="confirm" class:danger={destructive}>
						<p class="ctitle">
							{destructive ? 'Destructive action — confirm carefully' : 'Confirm action'}
						</p>
						<p class="csum">{assistant.summarise(assistant.proposed)}</p>
						<pre>{JSON.stringify(assistant.proposed.input, null, 2)}</pre>
						{#if destructive}
							<label class="gate">
								<span>Type <strong>{CONFIRM_WORD}</strong> to enable</span>
								<input
									type="text"
									bind:value={assistant.confirmTyped}
									placeholder={CONFIRM_WORD}
									autocomplete="off"
									spellcheck="false"
									aria-label="Type {CONFIRM_WORD} to confirm"
								/>
							</label>
						{/if}
						<div class="cbtns">
							<button
								class="go"
								class:danger={destructive}
								onclick={() => assistant.confirm()}
								disabled={assistant.loading || !assistant.canConfirm}
							>
								{destructive ? 'Confirm — delete' : 'Confirm & apply'}
							</button>
							<button class="no" onclick={() => assistant.dismissProposed()}>Cancel</button>
						</div>
					</div>
				{/if}

				{#if assistant.resultCards.length > 0}
					<div class="widgets">
						{#each assistant.resultCards as c (c.key)}
							<AssistantResultCard card={c} onclose={(k) => assistant.dismissResultCard(k)} />
						{/each}
					</div>
				{/if}

				{#if assistant.widgets.length > 0}
					<div class="widgets">
						{#each assistant.widgets as w (w.key)}
							<SettingWidget widget={w} onclose={(k) => assistant.closeWidget(k)} />
						{/each}
					</div>
				{/if}

				{#if assistant.contentWidgets.length > 0}
					<div class="widgets">
						{#each assistant.contentWidgets as w (w.key)}
							<ContentWidget
								widget={w}
								onclose={(k) => assistant.closeContentWidget(k)}
								onsaved={() => assistant.onContentSaved()}
							/>
						{/each}
					</div>
				{/if}
			</div>

			<div class="composer">
				{#if voiceSupported}
					<button
						class="mic"
						class:listening
						type="button"
						onclick={toggleMic}
						disabled={assistant.loading}
						aria-label={listening ? 'Stop dictation' : 'Start dictation'}
						aria-pressed={listening}
						title={listening ? 'Tap to stop' : 'Tap to talk'}
					>
						{#if listening}
							<!-- Recording: a stop square inside the mic's place -->
							<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
								<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
							</svg>
						{:else}
							<!-- Idle: a microphone glyph -->
							<svg
								viewBox="0 0 24 24"
								width="18"
								height="18"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<rect x="9" y="2" width="6" height="11" rx="3" />
								<path d="M5 11a7 7 0 0 0 14 0" />
								<line x1="12" y1="18" x2="12" y2="22" />
								<line x1="8" y1="22" x2="16" y2="22" />
							</svg>
						{/if}
					</button>
				{/if}
				<textarea
					bind:this={textarea}
					bind:value={assistant.draft}
					onkeydown={onKey}
					rows="1"
					placeholder={listening ? 'Listening…' : 'Ask the assistant…'}
					aria-label="Message"
				></textarea>
				<button
					class="send"
					onclick={() => submitDraft(assistant.draft)}
					disabled={assistant.loading || !assistant.draft.trim()}
				>
					Send
				</button>
			</div>
		</section>
	{:else}
		<button
			class="fab"
			type="button"
			onclick={() => assistant.toggleDock()}
			aria-label="Open assistant"
		>
			<span class="fab-dot" aria-hidden="true">◆</span>
			<span class="fab-label">Assistant</span>
			<kbd class="fab-kbd">⌘K</kbd>
		</button>
	{/if}
</div>

<style>
	/* The shell's .assistant-dock region is pinned bottom-right; this component
	   sizes itself there. Everything below is admin.css-token driven. */
	.dock {
		position: fixed;
		right: 1.2rem;
		/* --assistant-lift lets a page push the dock clear of its own fixed
		   furniture. The diary's phone layout sets it to the height of its action
		   dock, so the Assistant pill sits above Book/Walk-in instead of covering
		   them. Zero everywhere else, so nothing moves on any other screen. */
		bottom: calc(1.2rem + var(--assistant-lift, 0px));
		z-index: 60;
		font-family: var(--admin-font);
	}

	/* Collapsed pill */
	.fab {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.95rem;
		background: var(--admin-primary);
		color: var(--admin-primary-ink);
		border: 1px solid var(--admin-primary);
		border-radius: var(--admin-radius-pill);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		box-shadow: var(--admin-shadow-lg);
	}
	.fab:hover {
		filter: brightness(1.08);
	}
	.fab-dot {
		color: var(--admin-accent);
		font-size: 0.8rem;
		line-height: 1;
	}
	.fab-kbd {
		font-size: 0.68rem;
		padding: 0.1rem 0.35rem;
		border-radius: var(--admin-radius-sm);
		background: rgba(255, 255, 255, 0.16);
		border: 1px solid rgba(255, 255, 255, 0.22);
		color: var(--admin-primary-ink);
	}

	/* Expanded panel */
	.panel {
		display: flex;
		flex-direction: column;
		width: min(92vw, 380px);
		height: min(76vh, 560px);
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius-lg);
		box-shadow: var(--admin-shadow-lg);
		overflow: hidden;
		color: var(--admin-ink);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 0.9rem;
		border-bottom: 1px solid var(--admin-border);
	}
	.title {
		font-size: 0.95rem;
		font-weight: 600;
		flex: 1;
	}
	.expand {
		font-size: 0.78rem;
		color: var(--admin-muted);
		text-decoration: none;
		padding: 0.2rem 0.4rem;
		border-radius: var(--admin-radius-sm);
	}
	.expand:hover {
		background: var(--admin-surface-2);
		color: var(--admin-ink);
	}
	.collapse {
		background: none;
		border: 0;
		color: var(--admin-faint);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.2rem 0.35rem;
		border-radius: var(--admin-radius-sm);
	}
	.collapse:hover {
		background: var(--admin-surface-2);
		color: var(--admin-ink);
	}

	/* WP-S6-7 — spoken-readback mute toggle in the header. */
	.voicetoggle {
		background: none;
		border: 0;
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.2rem 0.35rem;
		border-radius: var(--admin-radius-sm);
	}
	.voicetoggle:hover {
		background: var(--admin-surface-2);
	}

	.notice {
		margin: 0;
		padding: 0.55rem 0.9rem;
		font-size: 0.78rem;
		background: var(--admin-surface-2);
		color: var(--admin-muted);
		border-bottom: 1px solid var(--admin-border);
	}

	.log {
		flex: 1;
		overflow-y: auto;
		padding: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.empty {
		color: var(--admin-muted);
		font-size: 0.85rem;
		line-height: 1.5;
	}
	/* admin-onboarding: "Explain this page" affordance in the empty state. */
	.explain {
		margin-top: 0.8rem;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--admin-accent, #d4a04c);
		border-radius: var(--admin-radius-pill);
		background: var(--admin-accent-soft);
		color: var(--admin-ink);
		cursor: pointer;
	}
	.explain::before {
		content: '?';
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.05rem;
		height: 1.05rem;
		border-radius: 50%;
		background: var(--admin-accent, #d4a04c);
		color: var(--admin-accent-ink, #1a1f2b);
		font-size: 0.72rem;
		font-weight: 800;
	}
	.explain:hover:not(:disabled) {
		filter: brightness(1.04);
	}
	.explain:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.7rem;
	}
	.chips-label {
		width: 100%;
		margin: 0 0 0.1rem;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--admin-faint);
	}
	.chip {
		font: inherit;
		font-size: 0.8rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius-pill);
		background: var(--admin-surface);
		color: var(--admin-ink);
		cursor: pointer;
	}
	.chip:hover:not(:disabled) {
		border-color: var(--admin-accent);
		background: var(--admin-accent-soft);
	}
	.chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.bubble {
		max-width: 85%;
		padding: 0.55rem 0.75rem;
		border-radius: var(--admin-radius-lg);
		font-size: 0.85rem;
		line-height: 1.5;
		word-wrap: break-word;
	}
	/* User bubbles are plain text — keep their line breaks. Assistant bubbles
	   render via AssistantMarkdown (real block elements), so no pre-wrap there. */
	.bubble.user {
		align-self: flex-end;
		background: var(--admin-primary);
		color: var(--admin-primary-ink);
		border-bottom-right-radius: var(--admin-radius-sm);
		white-space: pre-wrap;
	}
	.bubble.assistant {
		align-self: flex-start;
		background: var(--admin-surface-2);
		color: var(--admin-ink);
		border-bottom-left-radius: var(--admin-radius-sm);
	}

	.typing {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
	}
	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--admin-faint);
		animation: blink 1.2s infinite both;
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

	.confirm {
		align-self: stretch;
		background: var(--admin-surface-2);
		border: 1px solid var(--admin-warning);
		border-radius: var(--admin-radius);
		padding: 0.75rem 0.85rem;
	}
	.ctitle {
		margin: 0 0 0.25rem;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--admin-warning);
	}
	.csum {
		margin: 0 0 0.45rem;
		font-size: 0.86rem;
		font-weight: 600;
	}
	.confirm pre {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		padding: 0.45rem;
		border-radius: var(--admin-radius-sm);
		font-size: 0.72rem;
		overflow: auto;
		margin: 0 0 0.55rem;
		max-height: 8rem;
	}
	.cbtns {
		display: flex;
		gap: 0.5rem;
	}
	.go {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.85rem;
		background: var(--admin-success);
		color: #fff;
		border: 0;
		border-radius: var(--admin-radius);
		cursor: pointer;
	}
	.go:disabled {
		opacity: 0.55;
	}
	.no {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.85rem;
		background: var(--admin-surface);
		color: var(--admin-muted);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		cursor: pointer;
	}

	/* Destructive (type-to-confirm) variant — mirrors the full-page assistant view
	   so a delete-class write reads the same red framing in the dock. */
	.confirm.danger {
		background: var(--admin-surface);
		border-color: var(--admin-danger);
	}
	.confirm.danger .ctitle {
		color: var(--admin-danger);
	}
	.go.danger {
		background: var(--admin-danger);
		color: #fff;
	}
	.gate {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0 0 0.55rem;
		font-size: 0.76rem;
		color: var(--admin-ink);
	}
	.gate strong {
		letter-spacing: 0.05em;
	}
	.gate input {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--admin-danger);
		border-radius: var(--admin-radius-sm);
		background: var(--admin-surface);
		color: var(--admin-ink);
		text-transform: uppercase;
	}

	/* mf-autonomous-copilot — "Plan tonight" checklist */
	.plan-loading {
		align-self: stretch;
		font-size: 0.82rem;
		color: var(--admin-muted);
		padding: 0.4rem 0.2rem;
	}
	.plan-error {
		align-self: stretch;
		font-size: 0.82rem;
		padding: 0.55rem 0.7rem;
		border-radius: var(--admin-radius);
		background: var(--admin-tone-warn-bg, #fff4e0);
		color: var(--admin-tone-warn-fg, #b26a00);
		border: 1px solid var(--admin-tone-warn-fg, #b26a00);
	}
	.plan {
		align-self: stretch;
		background: var(--admin-surface-2);
		border: 1px solid var(--admin-border);
		border-left: 3px solid var(--admin-accent, #d4a04c);
		border-radius: var(--admin-radius);
		padding: 0.7rem 0.8rem 0.8rem;
	}
	.plan-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.plan-title {
		margin: 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
		color: var(--admin-accent, #b26a00);
	}
	.plan-x {
		background: none;
		border: 0;
		color: var(--admin-faint);
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
		border-radius: var(--admin-radius-sm);
	}
	.plan-x:hover {
		background: var(--admin-surface);
		color: var(--admin-ink);
	}
	.plan-headline {
		margin: 0.35rem 0 0;
		font-size: 0.86rem;
		font-weight: 600;
	}
	.plan-narration {
		margin: 0.3rem 0 0.55rem;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--admin-ink);
	}
	.plan-empty {
		margin: 0.4rem 0 0;
		font-size: 0.82rem;
		color: var(--admin-muted);
	}
	.plan-items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.plan-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0.6rem;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius-sm);
	}
	.plan-item.done {
		opacity: 0.6;
	}
	.pi-main {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.pi-tag {
		flex: 0 0 auto;
		font-size: 0.56rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.12rem 0.35rem;
		border-radius: 999px;
		color: #fff;
		margin-top: 0.1rem;
	}
	.pi-tag.seating {
		background: var(--admin-primary, #2f6bd4);
	}
	.pi-tag.risk {
		background: var(--admin-tone-danger-fg, #c0392b);
	}
	.pi-tag.message {
		background: var(--admin-accent, #d4a04c);
		color: var(--admin-accent-ink, #1a1f2b);
	}
	.pi-tag.note {
		background: var(--admin-muted);
	}
	.pi-text {
		min-width: 0;
	}
	.pi-title {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 600;
	}
	.pi-detail {
		margin: 0.15rem 0 0;
		font-size: 0.74rem;
		color: var(--admin-muted);
		line-height: 1.4;
	}
	.pi-actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		justify-content: flex-end;
	}
	.pi-apply {
		font: inherit;
		font-size: 0.74rem;
		font-weight: 600;
		border: 0;
		background: var(--admin-success, #2e7d32);
		color: #fff;
		border-radius: var(--admin-radius-sm);
		padding: 0.28rem 0.7rem;
		cursor: pointer;
	}
	.pi-apply:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.pi-skip {
		font: inherit;
		font-size: 0.74rem;
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
		color: var(--admin-muted);
		border-radius: var(--admin-radius-sm);
		padding: 0.28rem 0.6rem;
		cursor: pointer;
	}
	.pi-link {
		font-size: 0.74rem;
		color: var(--admin-primary);
		text-decoration: none;
		padding: 0.28rem 0.5rem;
	}
	.pi-link:hover {
		text-decoration: underline;
	}
	.pi-state {
		font-size: 0.72rem;
		font-weight: 600;
	}
	.pi-state.ok {
		color: var(--admin-success, #2e7d32);
	}
	.pi-state.muted {
		color: var(--admin-muted);
	}
	.pi-state.bad {
		color: var(--admin-tone-danger-fg, #c0392b);
	}
	.plan-foot {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.6rem;
		flex-wrap: wrap;
	}
	.plan-approve-all {
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		border: 0;
		background: var(--admin-primary, #2f3850);
		color: var(--admin-primary-ink, #fff);
		border-radius: var(--admin-radius);
		padding: 0.4rem 0.9rem;
		cursor: pointer;
	}
	.plan-note {
		font-size: 0.68rem;
		color: var(--admin-muted);
	}

	.widgets {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
		padding: 0.65rem;
		border-top: 1px solid var(--admin-border);
	}
	textarea {
		flex: 1;
		resize: none;
		max-height: 6rem;
		font: inherit;
		font-size: 0.85rem;
		line-height: 1.4;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		background: var(--admin-surface);
		color: var(--admin-ink);
	}
	textarea:focus {
		outline: none;
		border-color: var(--admin-accent);
	}
	/* WP-S6-7 — press-and-hold mic. touch-action:none + user-select:none so a
	   touch hold doesn't scroll the page or pop the context menu (mirrors the
	   resize-handle gesture in AIAssistantChat). */
	.mic {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		min-height: var(--admin-tap, 40px);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		background: var(--admin-surface-2);
		color: var(--admin-ink);
		line-height: 1;
		cursor: pointer;
	}
	.mic.listening {
		background: var(--admin-danger, #c0392b);
		border-color: var(--admin-danger, #c0392b);
		color: #fff;
		animation: micpulse 1s infinite ease-in-out;
	}
	.mic:disabled {
		opacity: 0.5;
		cursor: default;
	}
	@keyframes micpulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.08);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mic.listening {
			animation: none;
		}
	}
	.send {
		font: inherit;
		padding: 0.5rem 0.95rem;
		background: var(--admin-primary);
		color: var(--admin-primary-ink);
		border: 0;
		border-radius: var(--admin-radius);
		cursor: pointer;
	}
	.send:disabled {
		opacity: 0.5;
		cursor: default;
	}

	@media (max-width: 560px) {
		.dock {
			right: 0.8rem;
			bottom: calc(0.8rem + var(--assistant-lift, 0px));
		}
		.panel {
			width: min(94vw, 380px);
		}
	}

	/* On a phone the collapsed pill is a keyboard shortcut, a word and a diamond
	   competing with the board for the bottom of the screen. The diamond is the
	   only part that identifies it, so on a phone that's all it is: a circle,
	   thumb-sized, with the name kept as its accessible label. */
	@media (max-width: 1024px), (max-height: 500px) and (max-width: 1280px) {
		.fab {
			width: 46px;
			height: 46px;
			padding: 0;
			justify-content: center;
			border-radius: 50%;
		}
		.fab-label,
		.fab-kbd {
			display: none;
		}
		.fab-dot {
			font-size: 1.05rem;
		}
	}
</style>
