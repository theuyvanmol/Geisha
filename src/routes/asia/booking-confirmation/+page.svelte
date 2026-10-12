<script lang="ts">
	// ResDiary's post-booking redirect target for Asia. Deliberately bare — this
	// renders inside the booking widget's iframe, so no AsiaFloatNav / SiteFooter.
	// See BookingConfirmation.svelte for the full note.
	import { getBrand } from '$lib/data/brand';
	import BookingConfirmation from '$lib/components/guest/BookingConfirmation.svelte';
	const brand = getBrand('asia');
</script>

<div class="brand-page" data-brand="asia">
	<BookingConfirmation {brand} />
</div>
