<script lang="ts">
	// Touch Takeaway CTA — the restaurant's own online ordering (collection /
	// at-home), the route the old site used for all web ordering. Presented as
	// the alternative to Uber Eats (delivery) wherever ordering is pushed.
	// Uses the brand accent so it reads as "us" next to Uber's green badge.
	type Props = {
		href: string;
		label?: string;
		size?: 'sm' | 'md' | 'lg';
		variant?: 'solid' | 'outline';
	};
	let { href, label = 'Order for Takeaway', size = 'md', variant = 'outline' }: Props = $props();
</script>

<a
	class="tt {size} {variant}"
	{href}
	target="_blank"
	rel="noopener noreferrer"
	aria-label="{label} (opens our online ordering in a new tab)"
>
	<span class="tt-label">{label}</span>
</a>

<style>
	.tt {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		text-decoration: none;
		font-family: var(--font-sans);
		font-weight: 600;
		border-radius: 999px;
		line-height: 1;
		white-space: nowrap;
		transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
	}
	.tt:hover {
		transform: translateY(-1px);
	}
	.tt-label {
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	/* Solid = filled accent pill */
	.solid {
		background: var(--accent);
		color: var(--bg);
	}
	.solid:hover {
		background: var(--accent-2, var(--accent));
	}

	/* Outline = quieter placement, sits well beside the green Uber badge */
	.outline {
		background: transparent;
		color: var(--accent);
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.outline:hover {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.sm {
		font-size: 0.72rem;
		padding: 0.5rem 0.9rem;
	}
	.md {
		font-size: 0.85rem;
		padding: 0.7rem 1.2rem;
	}
	.lg {
		font-size: 1rem;
		padding: 0.95rem 1.6rem;
	}
</style>
