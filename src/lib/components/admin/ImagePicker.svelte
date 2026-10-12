<script lang="ts">
	// Admin image/video picker modal.
	//
	// It used to be two tabs — "Library" (the static files shipped in
	// static/Content folder/) and "Uploaded" — which meant finding a picture was
	// scrolling a wall of thumbnails whose only label was a filename, in whichever
	// of the two piles it happened to be in.
	//
	// Now there is ONE library, filtered by GALLERY (Food / Interior / Cocktails /
	// Events), because that's the vocabulary staff already use for the photos and
	// it's what they pick when they upload. A picture's category comes from the
	// gallery content blob; anything not in a gallery lands under "Not in a
	// gallery" rather than disappearing. Where an image came from (upload vs the
	// shipped library) is a footnote, shown as a small badge.
	import { STATIC_MEDIA, STATIC_VIDEO } from '$lib/data/static-media';
	import {
		GALLERY_CATEGORIES,
		categoryLabel,
		type GalleryCategory
	} from '$lib/data/gallery-categories';
	import { adminThumb, adminVideoPreview, adminVideoPoster } from '$lib/media/preview';
	import { retryImage } from '$lib/media/retryImage';
	// Just-uploaded files are drawn from the copy still in memory, session-wide, so
	// the gallery grid and edit modal behind this picker show them too.
	import { rememberLocalPreview, localPreview } from '$lib/media/localPreviews';
	import type { BrandId } from '$lib/data/brand';

	type Uploaded = { id: string; url: string; thumb?: string; alt: string; label: string };
	type GalleryEntry = { src: string; alt: string; category: GalleryCategory };
	type Item = {
		/** What gets saved into the content blob (full size). */
		url: string;
		/** Small variant actually loaded into the tile. */
		thumb: string;
		label: string;
		poster?: string;
		/** null = not in any gallery. */
		category: GalleryCategory | null;
		source: 'gallery' | 'upload' | 'shipped';
	};

	let {
		brand,
		kind = 'image',
		/** The chosen file, plus the gallery it belongs to (null when it isn't in one). */
		onpick,
		/**
		 * Whether an upload made here should be filed into the gallery server-side.
		 * The Gallery editor sets this false — it holds an unsaved copy of the whole
		 * blob, so it adds the new picture to that instead (see the upload endpoint).
		 */
		addToGallery = true,
		onclose
	}: {
		brand: BrandId;
		kind?: 'image' | 'video';
		onpick: (url: string, category?: GalleryCategory | null) => void;
		addToGallery?: boolean;
		onclose: () => void;
	} = $props();

	const isVideo = $derived(kind === 'video');

	let uploaded = $state<Uploaded[]>([]);
	let gallery = $state<GalleryEntry[]>([]);
	let loaded = $state(false);
	let uploading = $state(false);
	let uploadError = $state('');
	let query = $state('');
	/** 'all' | a category | 'none' (not in a gallery). */
	let filter = $state<'all' | GalleryCategory | 'none'>('all');
	/** Which gallery a newly uploaded picture joins. */
	let uploadCategory = $state<GalleryCategory | ''>('food');

	// --- upload feedback -----------------------------------------------------
	// An upload re-encodes a full ladder and pushes it to R2, which takes seconds.
	// With only the button's label changing, staff couldn't tell whether anything
	// had happened — so the file being sent shows as a real tile at the front of
	// the grid, from a local object URL, with a spinner over it.
	/** The file currently going up: { name, preview } from URL.createObjectURL. */
	let pending = $state<{ name: string; preview: string } | null>(null);
	/** Confirmation line, cleared after a few seconds. */
	let uploadDone = $state('');

	// One fetch on open: the uploads list AND the gallery that categorises it.
	$effect(() => {
		if (loaded) return;
		void (async () => {
			try {
				const res = await fetch(`/api/admin/media?brand=${brand}`);
				const data = await res.json();
				uploaded = data.media ?? [];
				gallery = (data.gallery ?? []).filter((g: GalleryEntry) => g.src);
			} catch {
				uploaded = [];
				gallery = [];
			} finally {
				loaded = true;
			}
		})();
	});

	const looksLikeVideo = (url: string) => /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url);
	const fileName = (url: string) =>
		decodeURIComponent((url.split('?')[0].split('/').pop() ?? url) || url);

	/**
	 * Every pickable file, de-duplicated by URL. Gallery entries win, because they
	 * are the ones carrying a category; then uploads (recent first, as the API
	 * sorts them); then the files shipped with the site.
	 */
	const items = $derived.by<Item[]>(() => {
		const out: Item[] = [];
		const seen = new Set<string>();
		const push = (it: Item) => {
			if (seen.has(it.url)) return;
			seen.add(it.url);
			out.push(it);
		};

		if (isVideo) {
			// The gallery is photographs, so clips are never categorised.
			for (const v of STATIC_VIDEO) {
				push({
					url: v.url,
					thumb: v.url,
					label: v.label,
					poster: v.poster,
					category: null,
					source: 'shipped'
				});
			}
			for (const u of uploaded) {
				if (looksLikeVideo(u.url)) {
					push({
						url: u.url,
						thumb: localPreview(u.url) ?? u.url,
						label: u.label || fileName(u.url),
						category: null,
						source: 'upload'
					});
				}
			}
			return out;
		}

		for (const g of gallery) {
			push({
				url: g.src,
				// A file uploaded a moment ago is drawn from memory: its R2 url isn't
				// dependably fetchable yet (blank tiles until a refresh).
				thumb: adminThumb(g.src),
				label: g.alt || fileName(g.src),
				category: g.category,
				source: 'gallery'
			});
		}
		for (const u of uploaded) {
			if (looksLikeVideo(u.url)) continue;
			push({
				url: u.url,
				thumb: localPreview(u.url) ?? u.thumb ?? u.url,
				label: u.alt || u.label || fileName(u.url),
				category: null,
				source: 'upload'
			});
		}
		for (const url of STATIC_MEDIA) {
			push({
				url,
				thumb: adminThumb(url),
				label: fileName(url),
				category: null,
				source: 'shipped'
			});
		}
		return out;
	});

	const counts = $derived.by(() => {
		const c: Record<string, number> = { all: items.length, none: 0 };
		for (const cat of GALLERY_CATEGORIES) c[cat] = 0;
		for (const it of items) c[it.category ?? 'none']++;
		return c;
	});

	const matching = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return items.filter((it) => {
			if (filter === 'none' && it.category !== null) return false;
			if (filter !== 'all' && filter !== 'none' && it.category !== filter) return false;
			if (q && !it.label.toLowerCase().includes(q) && !fileName(it.url).toLowerCase().includes(q))
				return false;
			return true;
		});
	});

	// Render in pages. Even at ~40 KB a thumbnail, dropping 140 <img> into the DOM
	// at once is a visible stall on open — and nobody scrolls past the first
	// screenful before they've filtered or searched.
	const PAGE = 48;
	let limit = $state(PAGE);
	// Any change to what's being shown starts the count again.
	$effect(() => {
		void filter;
		void query;
		limit = PAGE;
	});
	const shown = $derived(matching.slice(0, limit));

	async function onFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		uploadError = '';
		uploadDone = '';
		const preview = URL.createObjectURL(file);
		pending = { name: file.name, preview };
		try {
			const fd = new FormData();
			fd.set('file', file);
			fd.set('alt', file.name.replace(/\.[^.]+$/, ''));
			fd.set('brand', brand);
			if (!isVideo && uploadCategory) fd.set('category', uploadCategory);
			fd.set('addToGallery', addToGallery ? '1' : '0');
			const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
			if (!res.ok) throw new Error(await res.text());
			const rec = await res.json();
			// Keep the in-memory copy as this file's preview for the rest of the
			// session — see localPreviews.ts. Session-wide, so the gallery grid and
			// the edit modal behind this picker show it too.
			rememberLocalPreview(rec.url, preview);
			// The grids load the narrowest webp, which is a different url — record it
			// too, or those tiles go white until the CDN catches up.
			if (rec.thumb) rememberLocalPreview(rec.thumb, preview);
			uploaded = [
				{ id: rec.id, url: rec.url, thumb: preview, alt: rec.alt, label: file.name },
				...uploaded
			];
			// Mirror the server-side filing locally so the new picture shows under the
			// gallery it was just put in, without a refetch.
			if (rec.category) {
				gallery = [...gallery, { src: rec.url, alt: rec.alt, category: rec.category }];
			}
			// Take them straight to it — an upload is nearly always the thing they
			// then want to place.
			filter = rec.category ?? (isVideo ? 'all' : 'none');
			query = '';
			uploadDone = rec.category
				? `${file.name} uploaded and added to ${categoryLabel(rec.category)}.`
				: `${file.name} uploaded.`;
			setTimeout(() => (uploadDone = ''), 6000);
		} catch (err) {
			URL.revokeObjectURL(preview);
			uploadError = err instanceof Error ? err.message : 'Upload failed.';
		} finally {
			pending = null;
			uploading = false;
			input.value = '';
		}
	}

	/** Poster frame for a clip, if the video pipeline made one. */
	const posterOf = (it: Item) => it.poster ?? adminVideoPoster(it.url);
</script>

<div class="picker-backdrop" role="presentation" onclick={onclose}></div>
<div
	class="picker"
	role="dialog"
	aria-modal="true"
	aria-label={isVideo ? 'Choose a video' : 'Choose an image'}
>
	<header>
		<strong>{isVideo ? 'Choose a video' : 'Choose an image'}</strong>
		<div class="up">
			{#if !isVideo}
				<label class="upcat">
					Add to
					<select bind:value={uploadCategory} disabled={uploading}>
						{#each GALLERY_CATEGORIES as c}
							<option value={c}>{categoryLabel(c)}</option>
						{/each}
						<option value="">No gallery</option>
					</select>
				</label>
			{/if}
			<label class="upload">
				<input
					type="file"
					accept={isVideo ? 'video/*' : 'image/*'}
					onchange={onFile}
					disabled={uploading}
				/>
				{uploading ? 'Uploading…' : 'Upload new'}
			</label>
		</div>
		<button type="button" class="close" aria-label="Close" onclick={onclose}>✕</button>
	</header>

	{#if uploadError}<p class="err">{uploadError}</p>{/if}
	{#if pending}
		<p class="status">
			<span class="spin" aria-hidden="true"></span>
			Uploading {pending.name}… this takes a few seconds while it's resized for the web.
		</p>
	{:else if uploadDone}
		<p class="status done">{uploadDone} Click it to use it.</p>
	{/if}

	<div class="filters">
		{#if !isVideo}
			<div class="chips" role="group" aria-label="Filter by gallery">
				<button type="button" class:on={filter === 'all'} onclick={() => (filter = 'all')}>
					All <span class="n">{counts.all}</span>
				</button>
				{#each GALLERY_CATEGORIES as c}
					<button type="button" class:on={filter === c} onclick={() => (filter = c)}>
						{categoryLabel(c)} <span class="n">{counts[c]}</span>
					</button>
				{/each}
				<button type="button" class:on={filter === 'none'} onclick={() => (filter = 'none')}>
					Not in a gallery <span class="n">{counts.none}</span>
				</button>
			</div>
		{/if}
		<input class="search" placeholder="Search by name" bind:value={query} />
	</div>

	<div class="grid">
		<!-- The file being sent, shown as a real tile from the local copy so the
		     upload is visibly happening rather than a button that says "Uploading…". -->
		{#if pending}
			<div class="thumb pendingtile">
				{#if isVideo}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src={pending.preview} muted playsinline></video>
				{:else}
					<img src={pending.preview} alt="" />
				{/if}
				<span class="veil"><span class="spin big" aria-hidden="true"></span> Uploading…</span>
			</div>
		{/if}
		{#if !loaded}
			<p class="muted">Loading…</p>
		{:else if shown.length === 0 && !pending}
			<p class="muted">
				No {isVideo ? 'clips' : 'images'} here{query ? ` matching “${query}”` : ''}. Use “Upload
				new”.
			</p>
		{:else}
			{#each shown as it (it.url)}
				{@const poster = isVideo ? posterOf(it) : undefined}
				<button
					type="button"
					class="thumb"
					onclick={() => onpick(it.url, it.category)}
					title={it.label}
				>
					{#if isVideo && !poster}
						<!-- No poster frame: the clip itself is the only thumbnail there is.
						     preload="none" keeps it to a placeholder until it's clicked. -->
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={adminVideoPreview(it.url)} muted playsinline preload="none"></video>
					{:else}
						<img
							src={isVideo ? poster : it.thumb}
							use:retryImage
							alt=""
							loading="lazy"
							decoding="async"
						/>
					{/if}
					<span class="cap">{it.label}</span>
					{#if it.source === 'upload'}<span class="badge">uploaded</span>{/if}
				</button>
			{/each}
			{#if matching.length > shown.length}
				<button type="button" class="more" onclick={() => (limit += PAGE)}>
					Show more ({matching.length - shown.length} left)
				</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.picker-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(10, 14, 22, 0.55);
		z-index: 300;
	}
	.picker {
		position: fixed;
		z-index: 301;
		inset: 5vh 5vw;
		background: #fff;
		border-radius: 12px;
		box-shadow: 0 30px 80px -20px rgba(0, 0, 0, 0.5);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		font-family: 'Space Grotesk', sans-serif;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.8rem 1rem;
		border-bottom: 1px solid #e3e7ef;
	}
	header strong {
		font-size: 0.95rem;
	}
	.up {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.upcat {
		font-size: 0.78rem;
		color: #6b7488;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.upcat select {
		font: inherit;
		font-size: 0.8rem;
		padding: 0.3rem 0.4rem;
		border: 1px solid #cdd3df;
		border-radius: 6px;
		background: #fff;
		color: #1a1f2b;
	}
	.upload {
		font-size: 0.82rem;
		padding: 0.4rem 0.8rem;
		background: #1a1f2b;
		color: #fff;
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
	}
	.upload input {
		display: none;
	}
	.close {
		font: inherit;
		background: none;
		border: 0;
		font-size: 1.1rem;
		cursor: pointer;
		color: #6b7488;
	}
	.filters {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
		padding: 0.7rem 1rem 0;
	}
	.chips {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.chips button {
		font: inherit;
		font-size: 0.8rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid #cdd3df;
		background: #f4f5f7;
		border-radius: 999px;
		cursor: pointer;
		color: #1a1f2b;
	}
	.chips button.on {
		background: #2f6bd4;
		color: #fff;
		border-color: #2f6bd4;
	}
	.chips .n {
		opacity: 0.65;
		font-size: 0.72rem;
	}
	.search {
		margin-left: auto;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid #cdd3df;
		border-radius: 6px;
		min-width: 12rem;
	}
	.err {
		margin: 0.6rem 1rem 0;
		color: #b3261e;
		font-size: 0.82rem;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0.6rem 1rem 0;
		font-size: 0.82rem;
		color: #1a1f2b;
	}
	.status.done {
		color: #1e7a45;
	}
	.spin {
		width: 0.8rem;
		height: 0.8rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex: none;
	}
	.spin.big {
		width: 1.3rem;
		height: 1.3rem;
		border-width: 3px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	/* The upload in flight, drawn from the local file. */
	.pendingtile {
		position: relative;
		cursor: default;
	}
	.pendingtile img,
	.pendingtile video {
		filter: brightness(0.55);
	}
	.veil {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		color: #fff;
		font-size: 0.78rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 0.5rem;
		padding: 1rem;
		overflow: auto;
		align-content: start;
	}
	.thumb {
		position: relative;
		padding: 0;
		border: 1px solid #e3e7ef;
		border-radius: 6px;
		overflow: hidden;
		cursor: pointer;
		aspect-ratio: 1;
		background: #f4f5f7;
	}
	.thumb:hover {
		border-color: #2f6bd4;
		box-shadow: 0 0 0 2px rgba(47, 107, 212, 0.3);
	}
	.thumb img,
	.thumb video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	/* The name matters when two photos of the same dish differ only by crop. */
	.cap {
		position: absolute;
		inset: auto 0 0 0;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
		color: #fff;
		font-size: 0.68rem;
		line-height: 1.2;
		padding: 1rem 0.4rem 0.3rem;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
	}
	.more {
		grid-column: 1 / -1;
		font: inherit;
		font-size: 0.85rem;
		justify-self: center;
		margin: 0.6rem 0;
		padding: 0.5rem 1.2rem;
		border: 1px solid #cdd3df;
		background: #f4f5f7;
		border-radius: 6px;
		cursor: pointer;
	}
	.muted {
		grid-column: 1 / -1;
		color: #6b7488;
		font-size: 0.9rem;
	}
</style>
