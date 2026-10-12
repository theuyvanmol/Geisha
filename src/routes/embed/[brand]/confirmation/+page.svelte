<script lang="ts">
	// In-frame confirmation. Same component and same query-string contract as
	// /{brand}/booking-confirmation, but under the chromeless /embed layout — no
	// nav, no cookie banner, no assistant button.
	import BookingConfirmation from '$lib/components/guest/BookingConfirmation.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<!-- The widget page links Space Grotesk; this one linked nothing, so the guest's
     last screen dropped to system-ui under a Georgia heading. Same sans as the
     form they just used, plus the brand's display face for the two headings. -->
<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400&family=Space+Grotesk:wght@400;500&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div data-brand={data.brand.id}>
	<BookingConfirmation brand={data.brand} embedded />
</div>
