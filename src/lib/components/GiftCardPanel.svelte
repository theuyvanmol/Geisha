<script lang="ts">
	// Gift vouchers — our on-brand denomination picker, then hand off to Gift Up's
	// hosted checkout with the chosen voucher pre-selected. Gift Up takes the
	// payment and issues/redeems the voucher (see $lib/data/giftup.ts). The
	// account sells fixed £25/£50/£100 vouchers per brand, so the picker mirrors
	// exactly those amounts.
	import type { Brand } from '$lib/data/brand';
	import { giftUpAmounts, giftUpProductId, giftUpCheckoutUrl } from '$lib/data/giftup';

	let { brand, siteId = '' }: { brand: Brand; siteId?: string } = $props();

	const amounts = giftUpAmounts(brand.id);
	let amount = $state<number | null>(amounts.includes(50) ? 50 : (amounts[0] ?? null));

	const chosen = $derived(amount);

	function buy() {
		if (!chosen) return;
		if (!siteId) {
			// No Gift Up account configured — shouldn't happen (there's a default),
			// but never leave the button dead.
			alert('Gift vouchers are not available online just yet — please call the restaurant.');
			return;
		}
		window.location.href = giftUpCheckoutUrl(siteId, giftUpProductId(brand.id, chosen));
	}
</script>

<section class="gift" data-brand={brand.id}>
	<header class="head">
		<h1>Gift Vouchers</h1>
		<p class="lead">Know someone who loves Geisha? Give them the perfect gift.</p>
	</header>

	<div class="card">
		<div class="preview">
			<span class="pv-brand">{brand.name}</span>
			<span class="pv-amount">£{chosen || '—'}</span>
			<span class="pv-foot">Gift Voucher</span>
		</div>

		<div class="picker">
			<p class="label">Choose an amount</p>
			<div class="amounts">
				{#each amounts as a}
					<button class="amt" class:on={amount === a} onclick={() => (amount = a)}>
						£{a}
					</button>
				{/each}
			</div>

			<button class="buy" onclick={buy} disabled={!chosen}>Buy Voucher</button>
			<p class="fine">
				Available online or in the restaurant. Redeemable at {brand.name}. Payment handled
				securely by Gift Up.
			</p>
		</div>
	</div>
</section>

<style>
	.gift {
		max-width: 960px;
		margin: 0 auto;
		padding: 3rem 1.6rem 5rem;
		color: var(--ink);
		font-family: var(--font-body);
	}
	.head {
		text-align: center;
		margin-bottom: 2.6rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.6rem, 6vw, 4.2rem);
		margin: 0.3rem 0 0.4rem;
		font-weight: 500;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0;
	}
	.card {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.6rem;
		align-items: stretch;
	}
	.preview {
		background: linear-gradient(135deg, var(--accent), var(--accent-2, var(--accent)));
		color: #fff;
		border-radius: 12px;
		padding: 2.4rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		min-height: 220px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
	}
	.pv-brand {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		opacity: 0.9;
	}
	.pv-amount {
		font-size: 3.4rem;
		font-weight: 600;
	}
	.pv-foot {
		font-style: italic;
		opacity: 0.9;
	}
	.picker {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 2rem 1.8rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.label {
		font-family: var(--font-sans);
		font-size: 0.74rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-soft);
		margin: 0;
	}
	.amounts {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.6rem;
	}
	.amt {
		font-family: var(--font-serif);
		font-size: 1.15rem;
		min-height: 44px;
		padding: 0.75rem 0;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink);
		cursor: pointer;
		transition: all 0.2s ease;
	}
	.amt:hover {
		border-color: var(--accent);
	}
	.amt.on {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}
	.buy {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.15rem;
		padding: 0.9rem 1.4rem;
		border-radius: 4px;
		border: 0;
		background: var(--accent);
		color: var(--bg);
		cursor: pointer;
		margin-top: 0.4rem;
	}
	.buy:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.fine {
		font-size: 0.85rem;
		font-style: italic;
		color: var(--ink-faint);
		margin: 0;
	}
	@media (max-width: 680px) {
		.card {
			grid-template-columns: 1fr;
		}
	}
</style>
