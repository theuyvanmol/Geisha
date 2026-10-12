<script lang="ts">
	// The embeddable booking widget — what sits inside the iframe on the
	// restaurant's existing site, in place of the ResDiary widget.
	//
	// SHAPE OF THE FLOW (mirrors ResDiary's, deliberately)
	//   search  → date + guests
	//   time    → the available slots for that date/party
	//   option  → "An option is required for this booking" (Standard / brunch / …)
	//   details → name, email, phone, requests
	//   payment → inline card form, only when the option or the rules demand one
	//   → redirect the frame to the confirmation URL, ResDiary's parameters intact
	//
	// Staff and guests both already know that shape from the current system, and
	// the confirmation page it redirects to was written against ResDiary's query
	// string — so matching it means nothing downstream had to change.
	//
	// WHY THE CARD FORM IS INLINE
	// ---------------------------
	// This page runs in an iframe on another origin. Stripe's hosted Checkout sets
	// frame-ancestors, so redirecting to it from in here paints a blank box.
	// Stripe Elements is explicitly supported in nested iframes, so the card form
	// is mounted in place. (3-D Secure still works: Stripe opens its own modal
	// frame over ours.)
	//
	// EVERY STEP IS ONE SCREEN. The frame is short — the ResDiary one is 640px —
	// so anything that would make the guest scroll to find the button is split
	// into another step instead.
	import { onMount, tick } from 'svelte';
	import { loadStripe, preloadStripe, type StripeHandles } from '$lib/bookings/stripe';
	import { submitLabel, abandonReport } from '$lib/bookings/cardStep';
	import { hasSurname, joinGuestName, SURNAME_REQUIRED } from '$lib/guestName';
	import BookingCalendar from './BookingCalendar.svelte';

	type BrandInfo = { id: 'asia' | 'fusion'; name: string; phone: string; email: string };

	type Slot = { time: string; available: boolean };
	type BookingOption = {
		id: string;
		title: string;
		blurb?: string;
		price?: string;
		terms?: string;
		href?: string;
		isDefault: boolean;
		depositPence: number;
		depositKind: 'deposit' | 'noshow_hold' | 'none';
	};
	type PaymentReq = { kind: string; amountPence: number; reason: string };
	type PaymentSession = {
		paymentId: string;
		/** Only ever 'inline' when a card is genuinely collectable — Stripe's hosted
		 *  Checkout sets frame-ancestors and would render blank inside this iframe. */
		mode: 'inline' | 'manual_fallback';
		clientSecret?: string | null;
		publishableKey?: string | null;
		amountPence: number;
		kind: string;
	};

	let {
		brand,
		redirectTo = '',
		theme = 'light'
	}: { brand: BrandInfo; redirectTo?: string; theme?: 'light' | 'dark' } = $props();

	const tel = $derived(brand.phone.replace(/\s/g, ''));

	/**
	 * "Today" in the RESTAURANT'S wall-clock. `toISOString().slice(0,10)` reads the
	 * UTC day, which between midnight and 1am BST names YESTERDAY and offers it as
	 * the picker's minimum — this project has shipped that bug once already.
	 */
	const londonDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
	const today = londonDay(new Date());

	/** The host page's own copy says "more than 8, please call" — so the picker
	 *  stops there and the rest is a phone number, rather than offering a party
	 *  size the restaurant would rather take by phone. */
	const PARTY_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];
	/** The largest party this widget will book. Derived from the picker so the two
	 *  can never disagree: whatever the guest can choose is what the widget accepts.
	 *  The API's own `online_party_max` (30) is a separate, higher ceiling that
	 *  staff-side routes use — it is deliberately NOT the limit here. */
	const MAX_ONLINE_PARTY = PARTY_CHOICES[PARTY_CHOICES.length - 1];

	type Phase = 'search' | 'time' | 'option' | 'details' | 'payment' | 'working' | 'done';
	let phase = $state<Phase>('search');

	let date = $state(today);
	let party = $state(2);
	let maxDate = $state('');

	let slots = $state<Slot[]>([]);
	let closed = $state(false);
	let closureReason = $state('');
	let selectedTime = $state('');

	let options = $state<BookingOption[]>([]);
	let optionId = $state('');
	const chosenOption = $derived(options.find((o) => o.id === optionId) ?? null);

	// Two boxes, joined into one name on submit — see $lib/guestName.ts for why a
	// surname is required ("a table for 5 different Pauls").
	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let phone = $state('');
	let specialRequests = $state('');
	let marketingConsent = $state(false);
	let acceptedTerms = $state(false);

	let loading = $state(false);
	let errorMsg = $state('');

	let bookingId = $state('');
	let bookingRef = $state('');
	let payment = $state<PaymentReq | null>(null);
	let paymentSession = $state<PaymentSession | null>(null);

	// Stripe handles, created only when a payment is actually required — the SDK
	// is a third-party script and there is no reason to load it for the ~90% of
	// bookings that need no card.
	let stripe = $state<StripeHandles | null>(null);
	let cardMount = $state<HTMLDivElement | null>(null);
	let cardReady = $state(false);
	let paying = $state(false);
	// For the report sent if the guest leaves the card step — see onPageHide.
	let cardShownAt = 0;
	let readyMs: number | null = null;
	let payPresses = 0;

	const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
	const hhmm = (t: string) => t.slice(0, 5);
	const prettyDate = $derived(
		new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);
	const availableSlots = $derived(slots.filter((s) => s.available));

	onMount(() => {
		// Deep-link prefill, so the host page can link "book a table for 4" straight
		// into the right state. Unrecognised values are simply ignored.
		const qs = new URLSearchParams(location.search);
		const d = qs.get('date');
		if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today) date = d;
		// A party the PICKER wouldn't offer must not sneak in through the query
		// string. `?party=12` used to prefill 12, leave every chip unselected, and
		// still produce a bookable flow — quietly contradicting the "more than 8,
		// please call" line printed directly underneath it.
		const p = Number(qs.get('party'));
		if (Number.isInteger(p) && p >= 1 && p <= MAX_ONLINE_PARTY) party = p;
	});

	// A guest leaving the card step without paying used to leave no trace at all:
	// "never saw the form", "saw it and left" and "went to their banking app and never
	// came back" were the same untouched intent. Report which, as the page goes away.
	// sendBeacon survives the page closing; a successful payment has already moved
	// `phase` on (finish()), so it never reports.
	onMount(() => {
		const onPageHide = () => {
			if (phase !== 'payment' || !bookingId) return;
			const body = JSON.stringify(abandonReport({ cardReady, readyMs, payPresses, paying }));
			try {
				navigator.sendBeacon?.(
					`/api/bookings/${bookingId}/payment-issue`,
					new Blob([body], { type: 'application/json' })
				);
			} catch {
				// telemetry must never break a booking
			}
		};
		addEventListener('pagehide', onPageHide);
		return () => removeEventListener('pagehide', onPageHide);
	});

	/** Step 1 → 2. */
	async function findTimes(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		errorMsg = '';
		slots = [];
		selectedTime = '';
		try {
			const res = await fetch(`/api/availability?brand=${brand.id}&date=${date}&party=${party}`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			slots = data.slots ?? [];
			closed = data.closed ?? false;
			closureReason = data.closureReason ?? '';
			const windowDays = data.bookingWindow?.windowDays ?? 0;
			if (windowDays > 0) {
				const d = new Date();
				d.setDate(d.getDate() + windowDays);
				maxDate = londonDay(d);
			}
			phase = 'time';
		} catch (err) {
			errorMsg = message(err, 'Could not load availability. Please try again.');
		} finally {
			loading = false;
		}
	}

	/**
	 * Step 2 → 3. Loading the options needs the chosen TIME, not just the date —
	 * a lunchtime special and an evening special are different options on the same
	 * day, and offering both would let a guest book a menu the kitchen isn't
	 * running at that hour.
	 */
	async function chooseTime(t: string) {
		selectedTime = t;
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch(
				`/api/booking-options?brand=${brand.id}&date=${date}&time=${t}&party=${party}`
			);
			const data = res.ok ? await res.json() : { options: [] };
			options = data.options ?? [];
			optionId = (options.find((o: BookingOption) => o.isDefault) ?? options[0])?.id ?? '';
			// This booking will need a card: start fetching Stripe.js while the guest is
			// still choosing and typing, rather than after "Complete booking".
			if ((options.find((o: BookingOption) => o.id === optionId)?.depositPence ?? 0) > 0) {
				preloadStripe();
			}
			// One option and no terms to agree to is not a choice — skip the step
			// rather than making the guest click Select on a list of one.
			phase = options.length <= 1 && !options[0]?.terms ? 'details' : 'option';
		} catch (err) {
			errorMsg = message(err, 'Could not load booking options.');
			phase = 'details';
		} finally {
			loading = false;
		}
	}

	function chooseOption(id: string) {
		optionId = id;
		acceptedTerms = false;
		if ((options.find((o) => o.id === id)?.depositPence ?? 0) > 0) preloadStripe();
		phase = 'details';
	}

	/** Step 4 → book. */
	async function submitBooking(e: SubmitEvent) {
		e.preventDefault();
		const name = joinGuestName(firstName, lastName);
		if (!hasSurname(name)) {
			errorMsg = SURNAME_REQUIRED;
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/bookings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					brand: brand.id,
					date,
					time: selectedTime,
					partySize: party,
					option: optionId || undefined,
					customer: { name, email, phone, marketingConsent },
					specialRequests: specialRequests || undefined
				})
			});
			if (!res.ok) throw new Error(await errorText(res));
			const data = await res.json();

			bookingId = data.booking?.id ?? '';
			bookingRef = data.booking?.reference ?? '';
			payment = data.payment ?? null;
			paymentSession = data.paymentSession ?? null;

			// No card needed, or no provider configured — the booking is already
			// confirmed server-side, so go straight to the confirmation page.
			if (!paymentSession || paymentSession.mode === 'manual_fallback') {
				finish();
				return;
			}

			phase = 'payment';
			await tick();
			await mountCard();
		} catch (err) {
			errorMsg = message(err, 'Could not complete the booking. Please try again.');
		} finally {
			loading = false;
		}
	}

	/**
	 * Tell the server the card step went wrong, so a run of failures is visible
	 * somewhere other than this guest's console.
	 *
	 * Fire-and-forget in every sense: never awaited on a path the guest is
	 * watching, and its own failure is swallowed. The guest already has the error
	 * on screen; this is only for whoever asks later whether people are getting
	 * errors. `keepalive` so a report survives the guest closing the frame.
	 */
	function reportPaymentIssue(stage: string, code: string, msg: string) {
		if (!bookingId) return;
		try {
			void fetch(`/api/bookings/${bookingId}/payment-issue`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stage, code, message: msg }),
				keepalive: true
			}).catch(() => undefined);
		} catch {
			// never let telemetry break a payment
		}
	}

	/** Load Stripe.js and mount the Payment Element into the card slot. */
	async function mountCard() {
		const session = paymentSession;
		if (!session?.clientSecret || !session.publishableKey || !cardMount) return;
		cardShownAt = performance.now();
		try {
			stripe = await loadStripe(session.publishableKey, session.clientSecret, {
				theme,
				// Match the widget's own type so the card form doesn't look bolted on.
				fontFamily: "'Space Grotesk', system-ui, sans-serif",
				// The restaurant being booked — otherwise Stripe names the account's own
				// public name ("Geisha Bar and Grill") in the card-saving mandate.
				businessName: brand.name,
				// Only used by payment methods that genuinely must leave the page; a
				// card is confirmed in-frame. Same destination the widget would have
				// navigated to itself, so a redirecting method lands identically.
				returnUrl: confirmationUrl()
			});
			await stripe.mount(cardMount);
			readyMs = Math.round(performance.now() - cardShownAt);
			cardReady = true;
		} catch (err) {
			// A blocked third-party script is the likeliest cause here (ad blockers
			// routinely eat js.stripe.com). The booking EXISTS — it is just waiting
			// on payment — so tell the guest to call rather than implying it failed.
			console.error('[embed] Stripe failed to load:', err);
			errorMsg = `We couldn't load the secure card form. Your table is held — please call us on ${brand.phone} to confirm it.`;
			// The one failure Stripe can never tell us about: their script never ran,
			// so no intent was ever attempted and no webhook will ever fire.
			reportPaymentIssue('load', 'stripe_js_unavailable', message(err, 'Stripe.js failed to load'));
		}
	}

	/** Confirm the card, then reconcile server-side and redirect. */
	async function payNow() {
		if (!stripe || !paymentSession || paying) return;
		payPresses += 1;
		paying = true;
		errorMsg = '';
		try {
			// A deposit confirms a PaymentIntent (money moves); a card guarantee
			// confirms a SetupIntent (the card is filed, nothing is charged).
			const result = await stripe.confirm(paymentSession.kind === 'deposit' ? 'payment' : 'setup');
			if (result.error) {
				errorMsg = result.error;
				// A decline ALSO raises payment_intent.payment_failed, so this row can
				// duplicate the webhook's — deliberately. This one is what the guest was
				// actually shown, and it's the only record for the errors Stripe never
				// hears about (validation refused in-browser, network lost mid-confirm).
				reportPaymentIssue('confirm', 'card_confirm_failed', result.error);
				return;
			}

			phase = 'working';
			// Tell the server to re-read the intent from Stripe and confirm now,
			// rather than making the guest wait on the webhook. It verifies with
			// Stripe itself, so this is a nudge, not a claim.
			await fetch(`/api/bookings/${bookingId}/payment-complete`, { method: 'POST' }).catch(
				() => undefined
			);
			finish();
		} catch (err) {
			errorMsg = message(err, 'The payment could not be completed.');
			phase = 'payment';
			reportPaymentIssue('confirm', 'card_step_threw', message(err, 'unknown error'));
		} finally {
			paying = false;
		}
	}

	/**
	 * Leave for the confirmation page, carrying ResDiary's own parameters.
	 *
	 * The format is theirs, not ours, on purpose: /{brand}/booking-confirmation was
	 * written to parse exactly this, the client may point us at their existing
	 * WordPress thank-you page via ?redirect=, and anything already consuming those
	 * parameters (analytics goals, a Meta conversion) keeps working.
	 *
	 * Navigates the FRAME, not the top window — matching ResDiary, and because
	 * breaking out of the frame would throw away the page the guest was reading.
	 */
	function confirmationUrl(): string {
		// Default to the EMBED confirmation, not /{brand}/booking-confirmation: the
		// latter renders under the brand layout, so inside this frame it would arrive
		// wearing the site nav, the assistant button and a cookie banner.
		const target = redirectTo || `/embed/${brand.id}/confirmation`;
		const url = new URL(target, location.origin);
		if (bookingRef) url.searchParams.set('bookingReference', bookingRef);
		url.searchParams.set('date', `${date}T00:00:00`);
		url.searchParams.set('time', `${selectedTime}:00`);
		url.searchParams.set('partySize', String(party));
		return url.toString();
	}

	function finish() {
		phase = 'done';
		location.href = confirmationUrl();
	}

	/** SvelteKit errors arrive as JSON `{ message }`; anything else is passed through. */
	async function errorText(res: Response): Promise<string> {
		const text = await res.text().catch(() => '');
		try {
			const parsed = JSON.parse(text);
			return parsed?.message || text;
		} catch {
			return text || `Request failed (${res.status})`;
		}
	}

	function message(err: unknown, fallback: string): string {
		return err instanceof Error && err.message ? err.message : fallback;
	}

	function back(to: Phase) {
		errorMsg = '';
		phase = to;
	}
</script>

<div class="w" data-theme={theme} data-brand={brand.id}>
	<header class="w-head">
		<p class="w-name">{brand.name}</p>
		{#if phase !== 'search'}
			<p class="w-crumb">
				{prettyDate}
				{#if selectedTime}· {hhmm(selectedTime)}{/if}
				· {party}
				{party === 1 ? 'guest' : 'guests'}
			</p>
		{/if}
	</header>

	{#if errorMsg}
		<p class="w-error" role="alert">{errorMsg}</p>
	{/if}

	<!-- 1. DATE + GUESTS ------------------------------------------------------ -->
	{#if phase === 'search'}
		<form onsubmit={findTimes}>
			<div class="w-field">
				<span>Date</span>
				<BookingCalendar brand={brand.id} bind:value={date} partySize={party} {today} />
			</div>

			<fieldset class="w-field">
				<legend>Guests</legend>
				<div class="w-chips">
					{#each PARTY_CHOICES as n (n)}
						<button
							type="button"
							class="w-chip"
							class:is-on={party === n}
							onclick={() => (party = n)}
							aria-pressed={party === n}>{n}</button
						>
					{/each}
				</div>
			</fieldset>

			<button class="w-primary" type="submit" disabled={loading}>
				{loading ? 'Checking…' : 'Find a table'}
			</button>

			<p class="w-note">
				Booking for more than {PARTY_CHOICES[PARTY_CHOICES.length - 1]}? Please call us on
				<a href="tel:{tel}">{brand.phone}</a> and we'll arrange it.
			</p>
		</form>

		<!-- 2. TIMES ----------------------------------------------------------- -->
	{:else if phase === 'time'}
		{#if closed}
			<p class="w-empty">
				We're closed on {prettyDate}{closureReason ? ` — ${closureReason}` : ''}. Please try another
				date.
			</p>
		{:else if availableSlots.length === 0}
			<p class="w-empty">
				No tables left for {party}
				{party === 1 ? 'guest' : 'guests'} on {prettyDate}. Try another day or time — or call us on
				<a href="tel:{tel}">{brand.phone}</a>.
			</p>
		{:else}
			<p class="w-label">Choose a time</p>
			<div class="w-times">
				{#each availableSlots as slot (slot.time)}
					<button
						type="button"
						class="w-time"
						disabled={loading}
						onclick={() => chooseTime(hhmm(slot.time))}>{hhmm(slot.time)}</button
					>
				{/each}
			</div>
		{/if}
		<button class="w-back" type="button" onclick={() => back('search')}>← Change date</button>

		<!-- 3. OPTIONS --------------------------------------------------------- -->
	{:else if phase === 'option'}
		<p class="w-label">An option is required for this booking</p>
		<div class="w-options">
			{#each options as opt (opt.id)}
				<div class="w-option" class:is-on={optionId === opt.id}>
					<div class="w-option-copy">
						<p class="w-option-title">{opt.title}</p>
						{#if opt.blurb}<p class="w-option-blurb">{opt.blurb}</p>{/if}
						{#if opt.price}<p class="w-option-price">{opt.price}</p>{/if}
						{#if opt.depositPence > 0}
							<p class="w-option-deposit">
								{opt.depositKind === 'deposit'
									? `${money(opt.depositPence)} deposit, deducted from your bill`
									: `${money(opt.depositPence)} card guarantee — charged only for a no-show`}
							</p>
						{/if}
					</div>
					<button type="button" class="w-select" onclick={() => chooseOption(opt.id)}>Select</button
					>
				</div>
			{/each}
		</div>
		<button class="w-back" type="button" onclick={() => back('time')}>← Change time</button>

		<!-- 4. DETAILS --------------------------------------------------------- -->
	{:else if phase === 'details'}
		{#if chosenOption && chosenOption.title !== 'Standard Booking'}
			<p class="w-chosen">{chosenOption.title}</p>
		{/if}
		<!-- `id` + `name` on every field, not just `autocomplete`.
		     Chrome will not offer autofill for a control it cannot identify — it
		     reports "A form field element should have an id or name attribute" and
		     silently declines — so `autocomplete="name"` on its own was doing
		     nothing. This form is submitted by JS, so `name` is inert as far as the
		     request goes; it exists purely so the browser can fill it in. On a phone,
		     which is where most of these bookings happen, that is the difference
		     between three taps and typing an email address by hand. -->
		<form class="w-details" onsubmit={submitBooking}>
			<!-- Side by side: the details step has to fit the frame without scrolling,
			     so the second name box costs no height. -->
			<div class="w-pair">
				<label class="w-field" for="bk-first-name">
					<span>First name</span>
					<input
						id="bk-first-name"
						name="given-name"
						bind:value={firstName}
						required
						maxlength="60"
						autocomplete="given-name"
					/>
				</label>
				<!-- No minlength: a one-character surname (李, 王) is a real surname. The
				     submit handler checks it properly via hasSurname. -->
				<label class="w-field" for="bk-last-name">
					<span>Surname</span>
					<input
						id="bk-last-name"
						name="family-name"
						bind:value={lastName}
						required
						maxlength="60"
						autocomplete="family-name"
					/>
				</label>
			</div>
			<label class="w-field" for="bk-email">
				<span>Email</span>
				<input
					id="bk-email"
					name="email"
					type="email"
					bind:value={email}
					required
					maxlength="200"
					autocomplete="email"
				/>
			</label>
			<label class="w-field" for="bk-phone">
				<!-- Not marked optional: the house policy releases a table 20 minutes
				     after the booking time "if we don't hear from you", so a guest with
				     no number is a lost cover the restaurant can't rescue. -->
				<span>Phone</span>
				<input
					id="bk-phone"
					name="phone"
					type="tel"
					bind:value={phone}
					required
					maxlength="40"
					autocomplete="tel"
				/>
			</label>
			<label class="w-field" for="bk-requests">
				<span>Anything we should know?</span>
				<textarea
					id="bk-requests"
					name="specialRequests"
					bind:value={specialRequests}
					rows="2"
					maxlength="2000"
					autocomplete="off"
					placeholder="Allergies, a birthday, a table preference…"
				></textarea>
			</label>

			{#if chosenOption?.terms}
				<div class="w-terms">
					<p>{chosenOption.terms}</p>
					<label class="w-check">
						<input type="checkbox" bind:checked={acceptedTerms} required />
						<span>I've read and accept these terms.</span>
					</label>
				</div>
			{/if}

			<label class="w-check">
				<input type="checkbox" bind:checked={marketingConsent} />
				<span>Email me occasional news and offers.</span>
			</label>

			<button class="w-primary" type="submit" disabled={loading}>
				{loading ? 'Booking…' : submitLabel(chosenOption)}
			</button>
		</form>
		<button
			class="w-back"
			type="button"
			onclick={() => back(options.length > 1 ? 'option' : 'time')}>← Back</button
		>

		<!-- 5. PAYMENT --------------------------------------------------------- -->
	{:else if phase === 'payment'}
		<p class="w-label">
			{payment?.kind === 'deposit' ? 'Pay your deposit' : 'Confirm with a card'}
		</p>
		{#if payment?.reason}
			<p class="w-terms-inline">{payment.reason}</p>
		{/if}
		<p class="w-amount">
			{money(paymentSession?.amountPence ?? 0)}
			<span
				>{payment?.kind === 'deposit'
					? 'charged now, off your final bill'
					: 'held only if you don’t arrive'}</span
			>
		</p>

		<!-- Stripe mounts its own iframe in here; it is empty until then. The note sits
		     OVER the reserved space rather than in it, so Stripe gets an empty node and
		     nothing moves when the form arrives — on a slow phone line that took ~11s,
		     with only an empty box and a greyed-out Pay button to look at. -->
		<div class="w-card-wrap">
			{#if !cardReady && !errorMsg}
				<p class="w-card-loading" role="status">Loading secure card form…</p>
			{/if}
			<div class="w-card" bind:this={cardMount}></div>
		</div>

		<button class="w-primary" type="button" onclick={payNow} disabled={!cardReady || paying}>
			{paying
				? 'Processing…'
				: payment?.kind === 'deposit'
					? `Pay ${money(paymentSession?.amountPence ?? 0)}`
					: 'Confirm booking'}
		</button>
		<p class="w-note">
			Your table is held while you complete this. Card details are handled by Stripe — we never see
			them.
		</p>

		<!-- 6. WORKING / DONE -------------------------------------------------- -->
	{:else}
		<p class="w-empty">Confirming your booking…</p>
	{/if}
</div>

<style>
	.w {
		--ink: #1a1f2b;
		--muted: #6b7488;
		--line: #d9dde6;
		--accent: #c45a3a;
		--surface: #fff;
		max-width: 26rem;
		margin: 0 auto;
		/* 1rem at the bottom, not 2rem: the surface fills the frame anyway (see the
		   embed layout), so the extra rem was invisible — and on a phone it was the
		   difference between the details step fitting the host's frame and scrolling. */
		padding: 1.25rem 1rem 1rem;
		color: var(--ink);
		background: var(--surface);
		font-size: 15px;
		line-height: 1.5;
		/* A light card draws light native controls. This element carries data-brand,
		   and tokens.css gives [data-brand='fusion'] `color-scheme: dark` for the
		   site's own dark pages — which reached in here and painted Fusion's empty
		   tick-boxes as solid dark squares, looking already ticked. */
		color-scheme: light;
	}

	/* Asia's accent is the gold; Fusion's the terracotta. Set here rather than
	   pulled from tokens.css because this widget renders on a page we don't
	   control and must not depend on the site's brand wrappers being present. */
	.w[data-brand='asia'] {
		--accent: #b8873a;
	}

	.w[data-theme='dark'] {
		--ink: #f2efe9;
		--muted: #9aa3b5;
		--line: #3a3f4c;
		--surface: #14161c;
		color-scheme: dark;
	}

	.w-head {
		margin-bottom: 1.1rem;
	}

	.w-name {
		margin: 0;
		font-size: 0.75rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.w-crumb {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.w-label {
		margin: 0 0 0.75rem;
		font-size: 0.95rem;
		font-weight: 500;
	}

	.w-error {
		margin: 0 0 1rem;
		padding: 0.7rem 0.85rem;
		border-left: 3px solid #c0392b;
		background: color-mix(in srgb, #c0392b 8%, transparent);
		font-size: 0.85rem;
	}

	.w-empty {
		margin: 0 0 1.1rem;
		font-size: 0.9rem;
		color: var(--muted);
	}

	.w-field {
		display: block;
		margin: 0 0 0.9rem;
		border: 0;
		padding: 0;
	}

	.w-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0 0.6rem;
	}

	.w-pair .w-field {
		min-width: 0;
	}

	.w-field > span,
	.w-field > legend {
		display: block;
		margin-bottom: 0.3rem;
		/* A <legend> carries 2px of UA side padding, which set GUESTS 2px to the
		   right of DATE above it. */
		padding: 0;
		font-size: 0.75rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.w-field input,
	.w-field textarea {
		width: 100%;
		padding: 0.6rem 0.7rem;
		font: inherit;
		font-size: 16px; /* < 16px makes iOS Safari zoom the whole frame on focus */
		color: var(--ink);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 2px;
	}

	/* A textarea is inline-block, so it sat on the text baseline with ~6px of
	   descender space under it — the one field with a bigger gap below it than
	   the rest, and 6px the details step could not spare. */
	.w-field textarea {
		display: block;
	}

	/* THE DETAILS STEP HAS TO FIT THE HOST'S 820px FRAME.
	   With the terms box it ran 832px in a 390px-wide frame and 851px at 360 —
	   just enough to scroll the frame and push "← Back" out of it. Nothing here
	   is a tap target or wording: 3px off the gap under each field, plus the
	   terms box below, bring it to 791px / 809px. */
	.w-details .w-field,
	.w-details .w-terms {
		margin-bottom: 0.7rem;
	}

	.w-field input:focus-visible,
	.w-field textarea:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	/* Equal columns, not a wrapping flex row. Wrapped, the eight guest chips broke
	   7 + 1 in a phone-width frame (a lone "8" on its own line), and the times —
	   each as wide as its own digits — never lined up into columns and left a
	   ragged right edge. A grid gives both a straight edge on each side, level
	   with the calendar above. */
	.w-chips,
	.w-times {
		display: grid;
		gap: 0.4rem;
	}

	.w-chips {
		grid-template-columns: repeat(8, minmax(0, 1fr));
	}

	.w-times {
		grid-template-columns: repeat(auto-fill, minmax(3.6rem, 1fr));
	}

	/* Below ~336px eight across would be under 32px each. */
	@media (max-width: 21rem) {
		.w-chips {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.w-chip,
	.w-time {
		font: inherit;
		font-size: 0.9rem;
		padding: 0.5rem 0;
		min-width: 0;
		min-height: 2.75rem; /* 44px — these are tapped with a thumb far more than clicked */
		text-align: center;
		color: var(--ink);
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 2px;
		cursor: pointer;
	}

	.w-chip.is-on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.w-time:hover:not(:disabled),
	.w-chip:hover:not(.is-on) {
		border-color: var(--accent);
	}

	.w-time:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.w-primary {
		width: 100%;
		margin-top: 0.4rem;
		padding: 0.85rem 1rem;
		font: inherit;
		font-size: 0.78rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #fff;
		background: var(--accent);
		border: 0;
		border-radius: 2px;
		cursor: pointer;
	}

	.w-primary:disabled {
		opacity: 0.55;
		cursor: default;
	}

	/* Sits where it always did; the padding (cancelled by the smaller margins) is
	   there to turn a 19px-tall text link into a ~42px tap target. */
	.w-back {
		margin: 0.3rem 0 -0.5rem;
		font: inherit;
		font-size: 0.8rem;
		color: var(--muted);
		background: none;
		border: 0;
		padding: 0.7rem 0.75rem 0.7rem 0;
		cursor: pointer;
	}

	.w-note {
		margin: 0.85rem 0 0;
		font-size: 0.78rem;
		line-height: 1.55;
		color: var(--muted);
	}

	/* --- options ---------------------------------------------------------- */

	.w-options {
		display: grid;
		gap: 0.6rem;
	}

	.w-option {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 2px;
	}

	.w-option.is-on {
		border-color: var(--accent);
	}

	.w-option-copy {
		min-width: 0;
	}

	.w-option-title {
		margin: 0;
		font-size: 0.98rem;
		font-weight: 500;
	}

	.w-option-blurb,
	.w-option-price,
	.w-option-deposit {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.w-option-price {
		color: var(--ink);
	}

	.w-select {
		flex: none;
		font: inherit;
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		color: var(--ink);
		background: transparent;
		border: 1px solid currentColor;
		border-radius: 2px;
		cursor: pointer;
	}

	.w-chosen {
		margin: 0 0 0.9rem;
		padding: 0.5rem 0.7rem;
		font-size: 0.85rem;
		border-left: 3px solid var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}

	/* --- terms + payment --------------------------------------------------- */

	.w-terms {
		margin: 0 0 0.9rem;
		padding: 0.6rem 0.85rem;
		border: 1px solid var(--line);
		border-radius: 2px;
	}

	.w-terms p {
		margin: 0 0 0.45rem;
		font-size: 0.78rem;
		line-height: 1.45; /* ten lines of it at 360px — 1.55 cost the step 12px */
		color: var(--muted);
	}

	.w-terms-inline {
		margin: 0 0 0.9rem;
		font-size: 0.82rem;
		line-height: 1.55;
		color: var(--muted);
	}

	/* The whole row is the label, so the row is the tap target: padded to ~27px
	   with a 19px box, where it was a bare 13px UA checkbox on a 19px line. The
	   margin shrinks by what the padding adds, so the step is no taller. */
	.w-check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin: 0 0 0.55rem;
		padding: 0.25rem 0;
		font-size: 0.82rem;
		line-height: 1.45;
		cursor: pointer;
	}

	/* Last thing in the terms box — its own bottom margin doubled the box's
	   padding underneath it. */
	.w-terms .w-check {
		margin-bottom: 0;
	}

	.w-check input {
		width: 1.2rem;
		height: 1.2rem;
		margin: 0;
		flex: none;
		accent-color: var(--accent);
	}

	.w-amount {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		font-weight: 500;
	}

	.w-amount span {
		display: block;
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--muted);
	}

	/* Reserve the card form's footprint so the Pay button doesn't jump down the
	   screen the moment Stripe's iframe finishes loading. */
	.w-card {
		min-height: 13rem;
		margin-bottom: 0.9rem;
	}

	.w-card-wrap {
		position: relative;
	}

	.w-card-loading {
		position: absolute;
		inset: 0 0 0.9rem;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0;
		font-size: 0.85rem;
		color: var(--muted);
		pointer-events: none;
	}

	a {
		color: inherit;
		white-space: nowrap;
	}
</style>
