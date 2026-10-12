<script lang="ts">
	// ResDiary's post-booking redirect target for Fusion. Deliberately bare — this
	// renders inside the booking widget's iframe, so no SiteNav / FrameGrid /
	// SiteFooter. See BookingConfirmation.svelte for the full note.
	import { getBrand } from '$lib/data/brand';
	import BookingConfirmation from '$lib/components/guest/BookingConfirmation.svelte';
	const brand = getBrand('fusion');
</script>

<div class="brand-page" data-brand="fusion">
	<BookingConfirmation {brand} />
</div>
