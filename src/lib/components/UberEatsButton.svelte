<script lang="ts">
	// Uber Eats CTA — pushed across the site per spec §5a. Uses the official
	// brand green/black so it reads as legit. Pass the per-brand store URL.
	type Props = {
		href: string;
		label?: string;
		size?: 'sm' | 'md' | 'lg';
		variant?: 'solid' | 'outline';
	};
	let { href, label = 'Order on Uber Eats', size = 'md', variant = 'solid' }: Props = $props();
</script>

<a
	class="uber {size} {variant}"
	{href}
	target="_blank"
	rel="noopener noreferrer"
	aria-label="{label} (opens Uber Eats in a new tab)"
>
	<span class="ue-mark">Uber</span>
	<span class="ue-eats">Eats</span>
	<span class="ue-sep" aria-hidden="true">·</span>
	<span class="ue-label">{label}</span>
</a>

<style>
	.uber {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		font-family: var(--font-sans);
		font-weight: 600;
		border-radius: 999px;
		line-height: 1;
		white-space: nowrap;
		transition: transform 0.2s ease, filter 0.2s ease, background 0.2s ease, color 0.2s ease;
	}
	.uber:hover {
		transform: translateY(-1px);
		filter: brightness(1.04);
	}
	.ue-mark {
		font-weight: 700;
	}
	.ue-eats {
		font-weight: 700;
	}
	.ue-sep {
		opacity: 0.5;
	}
	.ue-label {
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	/* Solid = official green badge with black wordmark */
	.solid {
		background: var(--uber-green);
		color: var(--uber-ink);
	}
	.solid .ue-eats {
		color: var(--uber-ink);
	}

	/* Outline = quieter placement (footer, inline) */
	.outline {
		background: transparent;
		color: var(--uber-green);
		box-shadow: inset 0 0 0 1.5px var(--uber-green);
	}

	.sm {
		font-size: 0.72rem;
		padding: 0.5rem 0.9rem;
		gap: 0.35rem;
	}
	.md {
		font-size: 0.85rem;
		padding: 0.7rem 1.2rem;
	}
	.lg {
		font-size: 1rem;
		padding: 0.95rem 1.6rem;
	}

	@media (max-width: 520px) {
		.ue-sep,
		.ue-label {
			display: none;
		}
		.sm,
		.md,
		.lg {
			padding-left: 1rem;
			padding-right: 1rem;
		}
	}
</style>
