<script lang="ts" module>
	// The descriptor the assistant's open_content UI tool returns. Kept in lockstep
	// with ContentWidgetDescriptor in src/lib/server/ai/tools/toolsContent.ts (that
	// module is server-only; this local mirror is what the client imports so no
	// $lib/server type leaks into the bundle).
	import type { BrandId } from '$lib/data/brand';
	import type { MediaSlot } from '$lib/data/media';

	export type ContentWidgetDescriptor = {
		id: string;
		key: string;
		label: string;
		surface: string;
		editor: 'fields' | 'list' | 'media' | 'raw';
		brand: BrandId;
		mediaSlots?: MediaSlot[];
		value: unknown;
	};
</script>

<script lang="ts">
	// An editable content editor spawned beside the chat when the assistant calls
	// open_content (the content analogue of SettingWidget). The AI pre-fills `value`
	// with its proposed copy; the admin reviews, tweaks and clicks Save, which POSTs
	// the WHOLE blob to /api/admin/content (validated server-side against the same
	// Zod schema the /admin/content editor pages use).
	//
	// Four render modes, keyed off descriptor.editor:
	//   fields — recursive editor over the blob (home / home_extra / brand_info)
	//   list   — recursive editor over an array of items (offers / reviews)
	//   media  — the labelled slot pickers (reuses ImagePicker in image/video mode)
	//   raw    — a JSON textarea fallback for the heavy structured blobs (menus/gallery)
	//
	// The recursive editor walks the ACTUAL seeded object, so every field — including
	// ones we don't name — is preserved; the admin edits an in-place clone.
	import { untrack } from 'svelte';
	import ImagePicker from './ImagePicker.svelte';

	let {
		widget,
		onclose,
		onsaved
	}: {
		widget: ContentWidgetDescriptor;
		onclose: (key: string) => void;
		/** Called with the widget key after a successful save (parent can refresh). */
		onsaved?: (key: string) => void;
	} = $props();

	// Editable working copy — a deep clone of the seed so edits never mutate the
	// descriptor and untouched fields survive verbatim. Seeded once at mount
	// (untrack); the widget is keyed by content key in the parent, so re-opening a
	// key mounts a fresh instance with the new proposal.
	let value = $state<unknown>(untrack(() => structuredClone(widget.value)));
	let raw = $state(
		untrack(() => (widget.editor === 'raw' ? JSON.stringify(widget.value, null, 2) : ''))
	);
	let rawError = $state('');

	let saving = $state(false);
	let saved = $state(false);
	let err = $state('');
	let both = $state(false);

	// --- media picker state ---
	// Which media slot is being (re)picked, so ImagePicker knows the kind + target.
	let pickingSlot = $state<MediaSlot | null>(null);
	// A generic image-pick target for list editors (offers etc): the array + index +
	// field to write the chosen URL into.
	let pickingField = $state<{ obj: Record<string, unknown>; field: string } | null>(null);

	const isMedia = $derived(widget.editor === 'media');
	const isRaw = $derived(widget.editor === 'raw');

	/** Humanise a camelCase / snake_case field key into a label. */
	function humanise(key: string): string {
		const spaced = key
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.replace(/[_-]+/g, ' ')
			.trim();
		return spaced.charAt(0).toUpperCase() + spaced.slice(1);
	}

	/** A field whose name suggests it holds an image/media URL (offers.img, dish.img,
	 *  review avatar, etc.) — rendered with a thumbnail + picker rather than a text box. */
	function isImageField(key: string): boolean {
		return /(^|[^a-z])(img|image|photo|src|avatar|video|media)($|[^a-z])/i.test(key);
	}
	/** A long-text field → render a textarea rather than a single-line input. */
	function isLongField(key: string): boolean {
		return /(about|body|desc|description|note|blurb|sub|paragraph|lead|story|intro)/i.test(key);
	}

	function markDirty() {
		saved = false;
	}

	function openFieldPicker(obj: Record<string, unknown>, field: string) {
		pickingField = { obj, field };
	}
	function onFieldPick(url: string) {
		if (pickingField) {
			pickingField.obj[pickingField.field] = url;
			markDirty();
		}
		pickingField = null;
	}

	// --- media slot helpers ---
	function slotValue(slotKey: string): string {
		const v = value as Record<string, string>;
		return (v?.[slotKey] ?? '').trim();
	}
	function onSlotPick(url: string) {
		if (pickingSlot) {
			(value as Record<string, string>)[pickingSlot.key] = url;
			markDirty();
		}
		pickingSlot = null;
	}
	function clearSlot(slotKey: string) {
		(value as Record<string, string>)[slotKey] = '';
		markDirty();
	}

	async function save() {
		saving = true;
		saved = false;
		err = '';

		let payload: unknown = value;
		if (isRaw) {
			try {
				payload = JSON.parse(raw);
				rawError = '';
			} catch {
				rawError = 'That is not valid JSON.';
				saving = false;
				return;
			}
		}

		try {
			const res = await fetch('/api/admin/content', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ brand: widget.brand, key: widget.key, value: payload, both })
			});
			if (!res.ok) throw new Error((await res.text()) || 'Save failed.');
			saved = true;
			onsaved?.(widget.key);
			setTimeout(() => (saved = false), 2000);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Save failed.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="cwidget">
	<div class="whead">
		<div class="wtitle">
			<span class="label">{widget.label}</span>
			<span class="brand">{widget.brand}</span>
		</div>
		<button class="x" onclick={() => onclose(widget.key)} aria-label="Dismiss">✕</button>
	</div>
	<p class="surface">{widget.surface}</p>

	<div class="body">
		{#if isRaw}
			<!-- Heavy structured blobs (menus / gallery): edit as JSON. Validated on Save. -->
			<p class="rawhint">Edit as JSON — validated when you Save.</p>
			<textarea class="raw" bind:value={raw} oninput={markDirty} rows="14" spellcheck="false"
			></textarea>
			{#if rawError}<p class="err">{rawError}</p>{/if}
		{:else if isMedia}
			<!-- Media slots: each a labelled thumbnail that opens the picker in the right kind. -->
			<div class="slots">
				{#each widget.mediaSlots ?? [] as slot (slot.key)}
					{@const url = slotValue(slot.key)}
					<div class="slot">
						<button
							class="thumb {slot.kind}"
							type="button"
							onclick={() => (pickingSlot = slot)}
							title={slot.hint}
						>
							{#if url}
								{#if slot.kind === 'video'}
									<!-- svelte-ignore a11y_media_has_caption -->
									<video src={url} muted playsinline preload="metadata"></video>
								{:else}
									<img src={url} alt="" />
								{/if}
							{:else}
								<span class="pick">Choose {slot.kind}…</span>
							{/if}
						</button>
						<div class="slot-meta">
							<span class="slot-label">{slot.label}</span>
							<span class="slot-hint">{slot.hint}</span>
							<div class="slot-actions">
								<button type="button" class="mini" onclick={() => (pickingSlot = slot)}>
									{url ? 'Replace' : 'Choose'}
								</button>
								{#if url}
									<button type="button" class="mini ghost" onclick={() => clearSlot(slot.key)}>
										Reset to default
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else if widget.editor === 'list' && Array.isArray(value)}
			<!-- Arrays of items (offers / reviews). Recursive per-item editor. -->
			{#each value as item, i (i)}
				<div class="item">
					<div class="item-head">
						<span class="item-n">#{i + 1}</span>
						<button
							type="button"
							class="mini ghost"
							onclick={() => {
								value = (value as unknown[]).filter((_, n) => n !== i);
								markDirty();
							}}>Remove</button
						>
					</div>
					{@render objectFields(item as Record<string, unknown>)}
				</div>
			{/each}
		{:else if value && typeof value === 'object' && !Array.isArray(value)}
			<!-- A single object blob (home / home_extra / brand_info). -->
			{@render objectFields(value as Record<string, unknown>)}
		{:else}
			<p class="rawhint">Nothing editable here.</p>
		{/if}
	</div>

	<div class="actions">
		<label class="both">
			<input type="checkbox" bind:checked={both} onchange={markDirty} />
			Apply to both brands
		</label>
		<div class="grow"></div>
		{#if err}<span class="err">{err}</span>{/if}
		{#if saved}<span class="ok">Saved ✓</span>{/if}
		<button class="save" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
	</div>
</div>

<!-- Recursive object-field renderer. Handles primitives, nested objects, string
     arrays (comma line), and arrays of objects (repeaters). Preserves every field
     it walks, so untouched data survives a save. -->
{#snippet objectFields(obj: Record<string, unknown>)}
	<div class="fields">
		{#each Object.keys(obj) as k (k)}
			{@const v = obj[k]}
			{#if typeof v === 'string'}
				{#if isImageField(k)}
					<div class="field imgfield">
						<span class="flabel">{humanise(k)}</span>
						<div class="imgrow">
							<button
								type="button"
								class="thumb image sm"
								onclick={() => openFieldPicker(obj, k)}
								title="Choose image"
							>
								{#if v}<img src={v} alt="" />{:else}<span class="pick">Image…</span>{/if}
							</button>
							{#if v}
								<button
									type="button"
									class="mini ghost"
									onclick={() => {
										obj[k] = '';
										markDirty();
									}}>Clear</button
								>
							{/if}
						</div>
					</div>
				{:else if isLongField(k)}
					<label class="field">
						<span class="flabel">{humanise(k)}</span>
						<textarea
							rows="3"
							value={v}
							oninput={(e) => {
								obj[k] = e.currentTarget.value;
								markDirty();
							}}
						></textarea>
					</label>
				{:else}
					<label class="field">
						<span class="flabel">{humanise(k)}</span>
						<input
							value={v}
							oninput={(e) => {
								obj[k] = e.currentTarget.value;
								markDirty();
							}}
						/>
					</label>
				{/if}
			{:else if typeof v === 'number'}
				<label class="field">
					<span class="flabel">{humanise(k)}</span>
					<input
						type="number"
						step="any"
						value={v}
						oninput={(e) => {
							const n = Number(e.currentTarget.value);
							obj[k] = Number.isNaN(n) ? v : n;
							markDirty();
						}}
					/>
				</label>
			{:else if typeof v === 'boolean'}
				<label class="field cb">
					<input
						type="checkbox"
						checked={v}
						onchange={(e) => {
							obj[k] = e.currentTarget.checked;
							markDirty();
						}}
					/>
					<span class="flabel">{humanise(k)}</span>
				</label>
			{:else if Array.isArray(v) && v.every((x) => typeof x === 'string')}
				<!-- String array → one comma-separated line. -->
				<label class="field">
					<span class="flabel">{humanise(k)} (comma-separated)</span>
					<input
						value={(v as string[]).join(', ')}
						oninput={(e) => {
							obj[k] = e.currentTarget.value
								.split(',')
								.map((s) => s.trim())
								.filter(Boolean);
							markDirty();
						}}
					/>
				</label>
			{:else if Array.isArray(v)}
				<!-- Array of objects → a repeater of sub-editors. -->
				<div class="field">
					<span class="flabel">{humanise(k)}</span>
					<div class="subitems">
						{#each v as sub, si (si)}
							<div class="subitem">
								<div class="item-head">
									<span class="item-n">#{si + 1}</span>
									<button
										type="button"
										class="mini ghost"
										onclick={() => {
											obj[k] = (v as unknown[]).filter((_, n) => n !== si);
											markDirty();
										}}>Remove</button
									>
								</div>
								{#if sub && typeof sub === 'object' && !Array.isArray(sub)}
									{@render objectFields(sub as Record<string, unknown>)}
								{:else}
									<input
										value={String(sub ?? '')}
										oninput={(e) => {
											(v as unknown[])[si] = e.currentTarget.value;
											markDirty();
										}}
									/>
								{/if}
							</div>
						{/each}
						<button
							type="button"
							class="mini"
							onclick={() => {
								// Add a blank item shaped like the first, else an empty string.
								const template = v[0];
								const blank =
									template && typeof template === 'object' && !Array.isArray(template)
										? Object.fromEntries(
												Object.entries(template as Record<string, unknown>).map(([kk, vv]) => [
													kk,
													typeof vv === 'number' ? 0 : typeof vv === 'boolean' ? false : ''
												])
											)
										: '';
								obj[k] = [...(v as unknown[]), blank];
								markDirty();
							}}>+ Add</button
						>
					</div>
				</div>
			{:else if v && typeof v === 'object'}
				<!-- Nested object (e.g. brand_info.address) → indented sub-fields. -->
				<div class="field nested">
					<span class="flabel">{humanise(k)}</span>
					<div class="nestbox">
						{@render objectFields(v as Record<string, unknown>)}
					</div>
				</div>
			{/if}
		{/each}
	</div>
{/snippet}

{#if pickingSlot}
	<ImagePicker
		brand={widget.brand}
		kind={pickingSlot.kind}
		onpick={onSlotPick}
		onclose={() => (pickingSlot = null)}
	/>
{/if}
{#if pickingField}
	<ImagePicker brand={widget.brand} onpick={onFieldPick} onclose={() => (pickingField = null)} />
{/if}

<style>
	.cwidget {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius-lg);
		padding: 0.85rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.whead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.wtitle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.label {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--admin-ink);
	}
	.brand {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: var(--admin-accent-soft, var(--admin-surface-2));
		color: var(--admin-accent, var(--admin-muted));
		font-weight: 700;
	}
	.x {
		background: none;
		border: 0;
		color: var(--admin-faint);
		font-size: 0.78rem;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
	}
	.x:hover {
		color: var(--admin-ink);
	}
	.surface {
		margin: 0;
		font-size: 0.72rem;
		color: var(--admin-muted);
		line-height: 1.4;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: 46vh;
		overflow-y: auto;
		padding-right: 0.2rem;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.22rem;
	}
	.field.cb {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}
	.flabel {
		font-size: 0.7rem;
		color: var(--admin-muted);
		font-weight: 600;
	}
	input,
	textarea {
		font: inherit;
		font-size: 0.83rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		background: var(--admin-surface);
		color: var(--admin-ink);
		resize: vertical;
		width: 100%;
	}
	.raw {
		font-family: ui-monospace, monospace;
		font-size: 0.76rem;
	}
	.rawhint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--admin-muted);
	}
	.nested .nestbox,
	.subitems {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		border-left: 2px solid var(--admin-border);
		padding-left: 0.6rem;
		margin-top: 0.2rem;
	}
	.item,
	.subitem {
		background: var(--admin-surface-2);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		padding: 0.55rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.subitem {
		background: var(--admin-surface);
	}
	.item-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.item-n {
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--admin-faint);
	}
	.imgrow {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.thumb {
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius);
		overflow: hidden;
		cursor: pointer;
		background: var(--admin-surface-2);
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.thumb.sm {
		width: 56px;
		height: 56px;
		flex: 0 0 auto;
	}
	.thumb img,
	.thumb video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.thumb:hover {
		border-color: var(--admin-accent);
	}
	.pick {
		font-size: 0.66rem;
		color: var(--admin-muted);
		padding: 0.2rem;
		text-align: center;
	}
	/* media slots */
	.slots {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.slot {
		display: grid;
		grid-template-columns: 84px 1fr;
		gap: 0.6rem;
		align-items: start;
	}
	.slot .thumb {
		width: 84px;
		height: 60px;
	}
	.slot-meta {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.slot-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--admin-ink);
	}
	.slot-hint {
		font-size: 0.68rem;
		color: var(--admin-muted);
		line-height: 1.35;
	}
	.slot-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.15rem;
		flex-wrap: wrap;
	}
	.mini {
		font: inherit;
		font-size: 0.72rem;
		padding: 0.25rem 0.55rem;
		border: 0;
		border-radius: var(--admin-radius-sm);
		background: var(--admin-accent, var(--admin-primary));
		color: var(--admin-accent-ink, #fff);
		cursor: pointer;
	}
	.mini.ghost {
		background: var(--admin-surface);
		color: var(--admin-muted);
		border: 1px solid var(--admin-border);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		border-top: 1px solid var(--admin-border);
		padding-top: 0.55rem;
	}
	.both {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: var(--admin-muted);
	}
	.both input {
		width: auto;
	}
	.grow {
		flex: 1;
	}
	.save {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.95rem;
		background: var(--admin-accent);
		color: var(--admin-accent-ink);
		border: 0;
		border-radius: var(--admin-radius);
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.55;
	}
	.ok {
		font-size: 0.76rem;
		color: var(--admin-success);
	}
	.err {
		font-size: 0.74rem;
		color: var(--admin-danger);
	}
</style>
