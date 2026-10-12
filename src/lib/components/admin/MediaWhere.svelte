<script lang="ts">
	// "Where does this show?" wireframe.
	//
	// A thumbnail of a media file tells staff WHAT the clip is, never WHERE it
	// lands — which is why the Media editor used to feel like editing filenames.
	// This draws a tiny mock of the public page with the slot's region lit up, so
	// the card answers "which video am I about to replace?" at a glance.
	import type { MediaShape } from '$lib/data/media';

	let { shape, label = '' }: { shape: MediaShape; label?: string } = $props();

	// Human sentence used as the accessible name (the SVG itself is decorative).
	const WHERE: Record<MediaShape, string> = {
		'tile-left': 'Left-hand tile of the front screen',
		'tile-right': 'Right-hand tile of the front screen',
		hero: 'Full-width, at the very top of the page',
		band: 'Full-width band, part-way down the page',
		inset: 'Inset picture beside the text, part-way down',
		circle: 'Inside the round plate, part-way down'
	};
</script>

<figure class="where">
	<svg viewBox="0 0 100 70" role="img" aria-label={WHERE[shape]}>
		<!-- page frame -->
		<rect class="page" x="0.5" y="0.5" width="99" height="69" rx="3" />

		{#if shape === 'tile-left' || shape === 'tile-right'}
			<!-- front door: two tiles -->
			<rect class:hit={shape === 'tile-left'} class="box" x="5" y="10" width="43" height="50" rx="2" />
			<rect class:hit={shape === 'tile-right'} class="box" x="52" y="10" width="43" height="50" rx="2" />
			<rect class="line" x="40" y="3" width="20" height="3" rx="1.5" />
		{:else}
			<!-- an interior page: nav strip, then bands of content -->
			<rect class="line" x="6" y="4" width="18" height="3" rx="1.5" />
			<rect class="line" x="80" y="4" width="14" height="3" rx="1.5" />

			{#if shape === 'hero'}
				<rect class="box hit" x="5" y="11" width="90" height="28" rx="2" />
				<rect class="line" x="5" y="45" width="52" height="3" rx="1.5" />
				<rect class="line" x="5" y="52" width="70" height="3" rx="1.5" />
				<rect class="line" x="5" y="59" width="38" height="3" rx="1.5" />
			{:else if shape === 'band'}
				<rect class="box" x="5" y="11" width="90" height="14" rx="2" />
				<rect class="line" x="5" y="30" width="52" height="3" rx="1.5" />
				<rect class="box hit" x="5" y="38" width="90" height="24" rx="2" />
			{:else if shape === 'inset'}
				<rect class="box" x="5" y="11" width="90" height="14" rx="2" />
				<rect class="line" x="5" y="34" width="34" height="3" rx="1.5" />
				<rect class="line" x="5" y="41" width="40" height="3" rx="1.5" />
				<rect class="line" x="5" y="48" width="28" height="3" rx="1.5" />
				<rect class="box hit" x="52" y="30" width="43" height="32" rx="2" />
			{:else}
				<!-- circle (the Fusion plate motif) -->
				<rect class="box" x="5" y="11" width="90" height="14" rx="2" />
				<rect class="line" x="5" y="34" width="34" height="3" rx="1.5" />
				<rect class="line" x="5" y="41" width="40" height="3" rx="1.5" />
				<circle class="box hit" cx="72" cy="45" r="17" />
			{/if}
		{/if}
	</svg>
	<figcaption>{label || WHERE[shape]}</figcaption>
</figure>

<style>
	.where {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		width: 128px;
		flex: none;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.page {
		fill: var(--admin-bg);
		stroke: var(--admin-border);
		stroke-width: 1;
	}
	.box {
		fill: var(--admin-surface-2, #eee);
		stroke: var(--admin-border);
		stroke-width: 0.75;
	}
	.line {
		fill: var(--admin-border);
	}
	.hit {
		fill: var(--admin-accent);
		stroke: var(--admin-accent);
	}
	figcaption {
		font-size: 0.68rem;
		line-height: 1.35;
		color: var(--admin-muted);
		text-align: center;
	}
</style>
