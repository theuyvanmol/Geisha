<script lang="ts">
	// Public score page for the post-visit feedback email. Themed per brand via
	// data-brand + tokens.css, like /book/[token]. States: invalid link, the
	// "stop these emails" confirm, the score form, and the thank-you (which may
	// offer a Google review to a happy guest). Every write is a POST that the
	// server re-authorises from the token — see +page.server.ts for why a GET
	// never saves anything.
	import { enhance } from '$app/forms';
	import Seo from '$lib/components/Seo.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const brandId = $derived(data.invalid ? 'asia' : data.brand.id);
	const tel = $derived(data.invalid ? '' : data.brand.phone.replace(/\s/g, ''));

	const visitDay = $derived(
		data.invalid
			? ''
			: new Date(data.visitAt).toLocaleDateString('en-GB', {
					weekday: 'long',
					day: 'numeric',
					month: 'long',
					timeZone: 'Europe/London'
				})
	);

	// Seeded from the link (?score=) or an earlier answer; the guest can change it.
	// svelte-ignore state_referenced_locally
	let score = $state<number | null>(data.invalid ? null : data.preselect);
	// svelte-ignore state_referenced_locally
	let comment = $state(data.invalid ? '' : data.comment);
	let sending = $state(false);
	let editing = $state(false);

	const saved = $derived(form && 'saved' in form && form.saved && !editing ? form : null);
	const stopped = $derived(
		!data.invalid && ((form && 'stopped' in form && form.stopped) || (data.stopMode && data.optedOut))
	);
	const errorMessage = $derived(form && 'message' in form ? form.message : '');

	const SCORES = [0, 1, 2, 3, 4, 5];
</script>

<Seo title="How was your visit?{data.invalid ? '' : ` — ${data.brand.name}`}" noindex />

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Space+Grotesk:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="fb" data-brand={brandId}>
	{#if data.invalid}
		<section class="card">
			<h1 class="small">This link has expired</h1>
			<p class="soft">
				Feedback links only work for a few weeks after a visit. If there's something you'd like to
				tell us, we'd still love to hear it — please get in touch with the restaurant.
			</p>
		</section>
	{:else}
		<header class="head">
			<p class="eyebrow">{data.brand.name}</p>
			<h1>{data.stopMode ? 'Feedback emails' : 'How was your visit?'}</h1>
			{#if !data.stopMode}<p class="when">{visitDay}</p>{/if}
		</header>

		{#if data.stopMode}
			<section class="card">
				{#if stopped}
					<h2>Done</h2>
					<p class="soft">
						You won't get any more of these emails from us. Your booking confirmations and reminders
						are unaffected.
					</p>
				{:else}
					<h2>Stop feedback emails?</h2>
					<p class="soft">
						We'll stop asking how your visits went. You'll still get your booking confirmations and
						reminders.
					</p>
					{#if errorMessage}<p class="err">{errorMessage}</p>{/if}
					<div class="row">
						<!-- &stop=1 keeps the page in stop mode when this posts without JS. -->
						<form method="POST" action="?/stop&stop=1" use:enhance>
							<button type="submit" class="btn primary">Stop these emails</button>
						</form>
						<a class="btn ghost" href="?">Score my visit instead</a>
					</div>
				{/if}
			</section>
		{:else if saved}
			<section class="card thanks">
				<h2>Thank you</h2>
				{#if saved.score <= 2}
					<p class="soft">
						We're sorry your visit wasn't what it should have been, and thank you for telling us. If
						you'd like to talk it through, please call us on
						<a href="tel:{tel}">{data.brand.phone}</a>.
					</p>
				{:else if saved.score === 3}
					<p class="soft">Thanks for letting us know — it helps us get better.</p>
				{:else}
					<p class="soft">We're so glad you enjoyed it, and we hope to see you again soon.</p>
				{/if}

				{#if saved.googleReviewUrl}
					<div class="google">
						<p>Would you share that on Google? It really helps a local restaurant.</p>
						<a
							class="btn primary"
							href={saved.googleReviewUrl}
							target="_blank"
							rel="noopener noreferrer">Leave us a Google review</a
						>
					</div>
				{/if}

				<button type="button" class="link" onclick={() => (editing = true)}>
					Change my answer
				</button>
			</section>
		{:else}
			<section class="card">
				<form
					method="POST"
					action="?/submit"
					use:enhance={() => {
						sending = true;
						return async ({ update }) => {
							await update({ reset: false });
							sending = false;
							editing = false;
						};
					}}
				>
					<fieldset class="scores">
						<legend>Your score</legend>
						<div class="grid">
							{#each SCORES as s (s)}
								<label class="score" class:sel={score === s}>
									<input type="radio" name="score" value={s} bind:group={score} required />
									{s}
								</label>
							{/each}
						</div>
						<div class="ends"><span>Poor</span><span>Excellent</span></div>
					</fieldset>

					<label class="comment">
						Anything you'd like to tell us? <span class="opt">(optional)</span>
						<textarea name="comment" rows="4" maxlength={data.commentMax} bind:value={comment}
						></textarea>
					</label>

					{#if data.answered}
						<p class="soft note">You've answered already — sending again will update it.</p>
					{/if}
					{#if errorMessage}<p class="err">{errorMessage}</p>{/if}

					<button type="submit" class="btn primary send" disabled={sending || score === null}>
						{sending ? 'Sending…' : 'Send'}
					</button>
				</form>
			</section>
		{/if}

		<p class="foot">{data.brand.name} · <a href="tel:{tel}">{data.brand.phone}</a></p>
	{/if}
</main>

<style>
	.fb {
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--bg);
		color: var(--ink);
		font-family: var(--font-serif);
		max-width: 560px;
		margin: 0 auto;
		padding: 3rem 1rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
		box-sizing: border-box;
	}
	.head {
		text-align: center;
	}
	.eyebrow {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0 0 0.4rem;
	}
	h1 {
		font-size: clamp(2rem, 7vw, 2.8rem);
		font-weight: 500;
		margin: 0;
	}
	h1.small {
		font-size: 1.8rem;
		color: var(--accent);
		margin-bottom: 0.6rem;
	}
	.when {
		margin: 0.3rem 0 0;
		color: var(--ink-soft);
		font-style: italic;
	}
	h2 {
		font-size: 1.4rem;
		font-weight: 500;
		color: var(--accent);
		margin: 0 0 0.7rem;
	}
	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 1.5rem 1.25rem;
	}
	.soft {
		color: var(--ink-soft);
		line-height: 1.6;
		margin: 0 0 1rem;
	}
	.soft:last-child {
		margin-bottom: 0;
	}
	fieldset.scores {
		border: 0;
		padding: 0;
		margin: 0 0 1.4rem;
	}
	legend,
	.comment {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-soft);
		padding: 0;
		margin-bottom: 0.6rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.4rem;
	}
	.score {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 52px;
		font-size: 1.5rem;
		/* Cormorant's default figures are old-style: the row read "o I 2 3 4 5",
		   with the 3, 4 and 5 hanging below the others. A row of buttons to tap
		   wants lining figures — same face, all one height. */
		font-variant-numeric: lining-nums;
		color: var(--ink);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
		border: 1px solid var(--line);
		border-radius: 6px;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			background 0.15s ease,
			color 0.15s ease;
	}
	.score:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.score:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.score.sel {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg);
	}
	.score input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.ends {
		display: flex;
		justify-content: space-between;
		margin-top: 0.4rem;
		font-family: var(--font-sans);
		font-size: 0.75rem;
		color: var(--ink-faint);
	}
	.comment {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.opt {
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink-faint);
	}
	textarea {
		font-family: var(--font-serif);
		font-size: 1.05rem;
		padding: 0.7rem 0.8rem;
		border-radius: 4px;
		border: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
		color: var(--ink);
		resize: vertical;
		text-transform: none;
		letter-spacing: 0;
	}
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.note {
		margin: 1rem 0 0;
		font-style: italic;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.1rem;
		padding: 0.8rem 1.4rem;
		border-radius: 4px;
		border: 1px solid var(--accent);
		cursor: pointer;
		text-decoration: none;
		transition: filter 0.2s ease;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.primary {
		background: var(--accent);
		color: var(--bg);
	}
	.btn.primary:hover:not(:disabled) {
		filter: brightness(1.06);
	}
	.btn.ghost {
		background: transparent;
		color: var(--accent);
	}
	.send {
		width: 100%;
		margin-top: 1.2rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
	}
	.google {
		margin: 1.2rem 0 0;
		padding-top: 1.2rem;
		border-top: 1px solid var(--line);
	}
	.google p {
		margin: 0 0 0.8rem;
	}
	.link {
		margin-top: 1.2rem;
		padding: 0;
		background: none;
		border: 0;
		font: inherit;
		font-size: 0.95rem;
		color: var(--ink-faint);
		text-decoration: underline;
		cursor: pointer;
	}
	.err {
		color: var(--accent);
		font-style: italic;
		margin: 0.8rem 0 0;
	}
	a {
		color: var(--accent);
	}
	.foot {
		text-align: center;
		color: var(--ink-faint);
		font-style: italic;
		margin: 0;
	}

	@media (max-width: 480px) {
		/* The tracked-caps labels sat at ~11.5px. */
		.eyebrow,
		legend,
		.comment {
			font-size: 0.75rem;
		}
		/* "Stop these emails" / "Score my visit instead" wrap on a phone into two
		   boxes of different widths → one column, equal widths. The first is a
		   <button> inside its own <form>. */
		.row {
			flex-direction: column;
		}
		.row form {
			display: flex;
		}
		.row .btn {
			width: 100%;
			box-sizing: border-box;
		}
		/* A bare text link with no padding: ~18px to hit. */
		.link {
			margin-top: 0.5rem;
			padding: 0.7rem 0;
		}
	}
</style>
