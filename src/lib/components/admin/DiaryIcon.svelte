<script lang="ts" module>
	// DiaryIcon — the custom stroke-based icon set for the diary booking popover
	// (ResDiary parity). One <svg> per name, drawn on a 24×24 grid, stroked in
	// `currentColor` so each icon inherits the surrounding text/button colour. Kept
	// as a single component (rather than per-icon files) so the popover can pull any
	// glyph by name without N imports.
	//
	//   import DiaryIcon from '$lib/components/admin/DiaryIcon.svelte';
	//   <DiaryIcon name="edit" />            // toolbar / label glyph
	//   <DiaryIcon name="trash" size={18} /> // override the pixel size

	export type DiaryIconName =
		| 'edit'
		| 'comment'
		| 'reset'
		| 'trash'
		| 'lock'
		| 'noshow'
		| 'print'
		| 'more'
		| 'waitlist'
		| 'hash'
		| 'phone'
		| 'mail'
		| 'clock'
		| 'arrive'
		| 'leave'
		| 'party'
		| 'table'
		| 'channel'
		| 'tag'
		| 'menu'
		| 'occasion'
		| 'star'
		| 'check'
		| 'allergy'
		| 'note'
		| 'history'
		| 'card'
		| 'moneybag'
		| 'link'
		| 'bell'
		// `-solid` variants: filled silhouettes rather than 1.8px strokes. A hairline
		// outline all but vanishes at the ~13px the diary bars draw flags at, so the
		// on-bar glyphs use these; the popover keeps the lighter stroked set.
		| 'tag-solid'
		| 'comment-solid'
		| 'bell-solid'
		| 'link-solid'
		| 'clock-solid'
		| 'card-solid'
		| 'moneybag-solid';
</script>

<script lang="ts">
	let {
		name,
		size = 16,
		title = ''
	}: { name: DiaryIconName; size?: number; title?: string } = $props();

	// A `-solid` glyph is painted, not stroked — same 24×24 grid, opposite fill/stroke.
	const solid = $derived(name.endsWith('-solid'));
</script>

<!-- All paths share the same stroke setup; only the inner geometry differs by name.
     `currentColor` + no fill keeps them tinting with the host element. -->
<svg
	class="di"
	class:solid
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={solid ? 'currentColor' : 'none'}
	stroke={solid ? 'none' : 'currentColor'}
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden={title ? undefined : true}
	role={title ? 'img' : undefined}
	aria-label={title || undefined}
>
	{#if name === 'edit'}
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
	{:else if name === 'comment'}
		<path
			d="M21 11.5a8.38 8.38 0 0 1-9 8.4 9 9 0 0 1-4-1L3 20l1.3-4A8.5 8.5 0 0 1 12 3.5a8.38 8.38 0 0 1 9 8Z"
		/>
	{:else if name === 'reset'}
		<path d="M3 12a9 9 0 1 0 3-6.7" />
		<path d="M3 4v4h4" />
	{:else if name === 'trash'}
		<path d="M3 6h18" />
		<path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
		<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
		<path d="M10 11v6M14 11v6" />
	{:else if name === 'lock'}
		<rect x="4.5" y="11" width="15" height="10" rx="2" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	{:else if name === 'noshow'}
		<rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
		<path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
	{:else if name === 'print'}
		<path d="M6 9V3h12v6" />
		<rect x="4" y="9" width="16" height="8" rx="2" />
		<path d="M7 17h10v4H7z" />
		<path d="M17 12.5h.01" />
	{:else if name === 'more'}
		<circle cx="5" cy="12" r="1.4" />
		<circle cx="12" cy="12" r="1.4" />
		<circle cx="19" cy="12" r="1.4" />
	{:else if name === 'waitlist'}
		<path d="M3 6h12M3 12h12M3 18h8" />
		<path d="M16 15l4 3-4 3" />
	{:else if name === 'hash'}
		<path d="M5 9h14M5 15h14M9 4l-2 16M17 4l-2 16" />
	{:else if name === 'phone'}
		<path
			d="M5 3.5h3.2l1.4 4-2 1.4a13 13 0 0 0 5.5 5.5l1.4-2 4 1.4V18a2 2 0 0 1-2 2A15.5 15.5 0 0 1 3 5.5a2 2 0 0 1 2-2Z"
		/>
	{:else if name === 'mail'}
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<path d="M3.5 6.5 12 12l8.5-5.5" />
	{:else if name === 'clock'}
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 7.5V12l3 2" />
	{:else if name === 'arrive'}
		<path d="M4 12h14" />
		<path d="M13 6l6 6-6 6" />
	{:else if name === 'leave'}
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 7v5l3.5 2" />
		<path d="M12 3.5v1.5M20.5 12H19" />
	{:else if name === 'party'}
		<circle cx="9" cy="8" r="3" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<path d="M16 6.5a3 3 0 0 1 0 5.6" />
		<path d="M17.5 19a5.2 5.2 0 0 0-3-4.7" />
	{:else if name === 'table'}
		<path d="M7 3v7a3 3 0 0 0 0 0M7 3v8M5 3v3a2 2 0 0 0 2 2M9 3v3a2 2 0 0 1-2 2M7 11v10" />
		<path d="M17 3c-1.5 0-2.5 2-2.5 4.5S15.5 12 17 12v9" />
	{:else if name === 'channel'}
		<rect x="4" y="4" width="16" height="16" rx="3" />
	{:else if name === 'tag'}
		<path
			d="M3.5 12.5 11 5a2 2 0 0 1 1.4-.6H19a1.5 1.5 0 0 1 1.5 1.5v6.6a2 2 0 0 1-.6 1.4l-7.5 7.5a2 2 0 0 1-2.8 0l-6.1-6.1a2 2 0 0 1 0-2.8Z"
		/>
		<circle cx="16" cy="8" r="1.2" />
	{:else if name === 'menu'}
		<rect x="5" y="3" width="14" height="18" rx="2" />
		<path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
	{:else if name === 'occasion'}
		<rect x="4" y="9" width="16" height="11" rx="1.5" />
		<path d="M4 13h16" />
		<path d="M12 9V5" />
		<path
			d="M12 5c0-1.5-1-2.5-2.2-2C8.5 3.5 9 5 12 5ZM12 5c0-1.5 1-2.5 2.2-2C15.5 3.5 15 5 12 5Z"
		/>
	{:else if name === 'star'}
		<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.6 1-5.8L3.5 9.7l5.9-.9Z" />
	{:else if name === 'check'}
		<circle cx="12" cy="12" r="8.5" />
		<path d="M8.5 12.2l2.4 2.4 4.6-4.8" />
	{:else if name === 'allergy'}
		<path d="M12 3.5 21 19.5H3Z" />
		<path d="M12 10v4M12 17h.01" />
	{:else if name === 'note'}
		<path d="M16 3.5 20.5 8 9 19.5l-5 1.5 1.5-5Z" />
		<path d="M13.5 6 18 10.5" />
	{:else if name === 'history'}
		<circle cx="9" cy="8" r="3.2" />
		<path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
		<circle cx="17.5" cy="16.5" r="4" />
		<path d="M17.5 14.7v1.8l1.3.9" />
	{:else if name === 'card'}
		<rect x="2.5" y="5" width="19" height="14" rx="2.2" />
		<path d="M2.5 9.5h19" />
		<path d="M6 14.5h3.5" />
	{:else if name === 'moneybag'}
		<!-- deposit / booking fee. A bag with a tied neck and a £ on it — ResDiary's
		     money-bag, which is what staff look for when a party says "we've paid". -->
		<path
			d="M9 3.2h6l-1.7 3.2c3.3 1.4 5.9 4.9 5.9 8.4 0 4.1-3.1 6.7-7.2 6.7s-7.2-2.6-7.2-6.7c0-3.5 2.6-7 5.9-8.4Z"
		/>
		<path d="M13.6 11.6a1.9 1.9 0 0 0-3.2 1.4v4.6" />
		<path d="M9.6 14.7h3M9.6 17.6h4.8" />
	{:else if name === 'link'}
		<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7" />
		<path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7" />
	{:else if name === 'bell'}
		<path d="M18 16H6l1.5-2.2V10a4.5 4.5 0 0 1 9 0v3.8Z" />
		<path d="M10.2 19a2 2 0 0 0 3.6 0" />
	{:else if name === 'tag-solid'}
		<!-- evenodd: the second subpath is the punched-out eyelet, so the tag reads as a
		     tag and not a black lozenge once it's shrunk to bar size. -->
		<path
			fill-rule="evenodd"
			d="M20.5 3.5h-7.1c-.64 0-1.25.25-1.7.7L3.4 12.4a2.6 2.6 0 0 0 0 3.7l4.5 4.5a2.6 2.6 0 0 0 3.7 0l8.2-8.2c.45-.45.7-1.06.7-1.7V3.5Zm-4.1 2.2a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z"
		/>
	{:else if name === 'comment-solid'}
		<path
			d="M4 3.6h16a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2h-7.2l-4.6 3.6v-3.6H4a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2Z"
		/>
	{:else if name === 'bell-solid'}
		<path
			d="M12 2.6a4.9 4.9 0 0 0-4.9 4.9v3.6L5.3 15a.9.9 0 0 0 .8 1.3h11.8a.9.9 0 0 0 .8-1.3l-1.8-3.9V7.5A4.9 4.9 0 0 0 12 2.6Z"
		/>
		<path d="M9.9 17.8a2.2 2.2 0 0 0 4.2 0Z" />
	{:else if name === 'link-solid'}
		<path d="M10.5 7.2H8a4.8 4.8 0 0 0 0 9.6h2.5v-2.6H8a2.2 2.2 0 0 1 0-4.4h2.5V7.2Z" />
		<path d="M13.5 7.2H16a4.8 4.8 0 0 1 0 9.6h-2.5v-2.6H16a2.2 2.2 0 0 0 0-4.4h-2.5V7.2Z" />
		<path d="M8.4 10.7h7.2v2.6H8.4Z" />
	{:else if name === 'clock-solid'}
		<path
			fill-rule="evenodd"
			d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm1 4.6a1 1 0 0 0-2 0v5a1 1 0 0 0 .49.86l3.2 1.9a1 1 0 0 0 1.02-1.72L13 11.6V7.6Z"
		/>
	{:else if name === 'card-solid'}
		<!-- "a card is held against this booking" (a no-show guarantee, not money taken).
		     evenodd: the magnetic stripe and the number band are punched out, so the card
		     still reads as a card rather than a filled lozenge at bar size. -->
		<path
			fill-rule="evenodd"
			d="M3.4 4.6h17.2A2.4 2.4 0 0 1 23 7v10a2.4 2.4 0 0 1-2.4 2.4H3.4A2.4 2.4 0 0 1 1 17V7a2.4 2.4 0 0 1 2.4-2.4ZM1 8.7h22v2.3H1V8.7Zm4.2 5.8h4.6v1.9H5.2v-1.9Z"
		/>
	{:else if name === 'moneybag-solid'}
		<!-- "a booking fee was taken / asked for". Same evenodd trick: the £ is punched
		     out of the bag so it survives being shrunk onto a diary bar. -->
		<path
			fill-rule="evenodd"
			d="M9 3.2h6l-1.7 3.2c3.3 1.4 5.9 4.9 5.9 8.4 0 4.1-3.1 6.7-7.2 6.7s-7.2-2.6-7.2-6.7c0-3.5 2.6-7 5.9-8.4L9 3.2Zm4.6 7.4a2.9 2.9 0 0 0-4.2 2.6v.8H8.3v1.6h1.1v1.1H8.3v1.7h7v-1.7h-3.9v-1.1h2.4v-1.6h-2.4v-.8c0-.7.5-1.1 1.2-1.1.4 0 .8.15 1.1.45l1.2-1.2a3 3 0 0 0-1.3-.75Z"
		/>
	{/if}
</svg>

<style>
	.di {
		display: inline-block;
		vertical-align: middle;
		flex: 0 0 auto;
	}
</style>
