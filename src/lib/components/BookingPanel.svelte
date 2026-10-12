<script lang="ts">
	// Customer-facing booking entry point + policy, themed per brand.
	//
	// Wired to the bespoke booking system (BOOKING_SYSTEM_PLAN.md): the form calls
	// GET /api/availability for real slots, then POST /api/bookings to create the
	// reservation. When a deposit / no-show hold is required, POST returns a
	// `paymentSession` and the widget enters a 'payment' phase: it redirects to the
	// hosted checkout when one is available, else shows a graceful
	// "we'll confirm shortly" path. The Stripe webhook is the source of truth for
	// confirming the booking; this widget can poll /api/bookings/[id]/status.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { Brand } from '$lib/data/brand';
	import type { PublicHours } from '$lib/hours';
	import { staticPublicHours } from '$lib/hours';
	import { hasSurname, joinGuestName, SURNAME_REQUIRED } from '$lib/guestName';

	let { brand }: { brand: Brand } = $props();

	type Slot = { time: string; available: boolean };
	type SetMenu = { id: string; name: string; pricePence: number; courses?: string };
	type PaymentReq = { kind: string; amountPence: number; reason: string };
	type PaymentSession = {
		paymentId: string;
		mode: 'hosted' | 'inline' | 'manual_fallback';
		hostedUrl?: string | null;
		clientSecret?: string | null;
		amountPence: number;
		kind: string;
	};

	const tel = $derived(brand.phone.replace(/\s/g, ''));
	/**
	 * "Today" in the RESTAURANT'S wall-clock, not the browser's, and not UTC.
	 * `toISOString().slice(0,10)` was silently wrong twice over: it reads the UTC
	 * day, so between midnight and 1am BST it named YESTERDAY and offered it as the
	 * picker's minimum. en-CA gives 'YYYY-MM-DD' directly.
	 */
	const londonDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
	const today = londonDay(new Date());

	// Largest party a guest can book online; bigger parties are routed to phone so
	// staff can place them (staff bookings bypass this cap). Matches the server-side
	// `online_party_max` default in booking/queries.ts — keep the two in step.
	const MAX_ONLINE_PARTY = 30;

	// WP-S9-3 stepper machine: 'date' → 'party' → 'slot' → 'details' → ('payment')
	// → 'done'. Two terminal side-states sit outside the linear flow: 'waitlisted'
	// (a fully-booked, non-closed date captured a waitlist request) and 'closed'
	// handling stays inside the 'slot' step. The visible step indicator below maps
	// these to numbered stages 1–5.
	let phase = $state<
		'date' | 'party' | 'slot' | 'details' | 'payment' | 'done' | 'waitlisted'
	>('date');

	// Ordered linear steps for the indicator; 'done' and 'waitlisted' are terminal
	// and don't appear as a numbered stage.
	const STEPS = ['date', 'party', 'slot', 'details', 'payment'] as const;
	const stepLabels: Record<(typeof STEPS)[number], string> = {
		date: 'Date',
		party: 'Guests',
		slot: 'Time',
		details: 'Details',
		payment: 'Payment'
	};
	const activeIndex = $derived(STEPS.indexOf(phase as (typeof STEPS)[number]));
	const inStepper = $derived(activeIndex >= 0);

	let date = $state(today);
	let party = $state(2);

	let slots = $state<Slot[]>([]);
	let requiresPhone = $state(false);
	let closed = $state(false);
	let closureReason = $state('');
	let loading = $state(false);
	let errorMsg = $state('');
	let selectedTime = $state('');

	// Waitlist (WP-AVAIL-5): a time window the guest would accept.
	let showWaitlist = $state(false);
	let waitFrom = $state('18:00');
	let waitTo = $state('21:00');

	// Two boxes, joined into one name on submit — see $lib/guestName.ts for why a
	// surname is required ("a table for 5 different Pauls").
	let firstName = $state('');
	let lastName = $state('');
	const name = $derived(joinGuestName(firstName, lastName));
	let email = $state('');
	let phone = $state('');
	let occasion = $state('');
	let specialRequests = $state('');
	// Optional set-menu pre-order (ResDiary-style). Catalogue is fetched on mount;
	// when empty the select is simply not shown. '' = no pre-order.
	let setMenus = $state<SetMenu[]>([]);
	let setMenuId = $state('');
	let consent = $state(false);
	let payment = $state<PaymentReq | null>(null);
	let bookingId = $state('');
	let paymentSession = $state<PaymentSession | null>(null);
	let bookingStatus = $state<string>('');
	let polling = $state(false);

	// Live booking horizon (WP-AVAIL-3): max selectable date. Filled from the
	// /api/availability response; until then fall back to a generous static window.
	let maxDate = $state('');

	// Public opening hours from the LIVE service periods — the same rows this
	// widget's availability comes from, and the same rows the admin diary runs on.
	// Served with the page by the brand layout load (`data.hours`) rather than
	// fetched on mount, so the aside renders correct on the first paint instead of
	// briefly showing the static marketing copy. `staticPublicHours` is only a
	// shape-of-last-resort if this is ever mounted outside a brand layout.
	const liveHours = $derived<PublicHours>(
		(page.data.hours as PublicHours | undefined) ??
			staticPublicHours(brand.id, brand.hours, brand.hoursNote ?? '')
	);
	const hoursNote = $derived(
		[liveHours.lastBookingNote, liveHours.note].filter(Boolean).join(' ')
	);

	onMount(() => {
		// Deep-link prefill (WP-S6 guest assistant): the "Ask Geisha" availability
		// card links here with ?date=&party=&time= so tapping a time chip drops the
		// guest straight onto the right step instead of an empty form. We read the
		// params, seed date/party, then auto-run availability; if a valid &time= is
		// present and still bookable we pre-select it and jump to the details step.
		void prefillFromQuery();

		// Bookable set menus for the optional pre-order. Failure / empty → no select.
		fetch(`/api/setmenus?brand=${brand.id}`)
			.then((r) => (r.ok ? r.json() : { setMenus: [] }))
			.then((d) => {
				setMenus = Array.isArray(d.setMenus) ? d.setMenus : [];
			})
			.catch(() => {
				setMenus = [];
			});
	});

	const moneyGBP = (pence: number) => `£${(pence / 100).toFixed(2)}`;
	const hhmm = (t: string) => t.slice(0, 5);

	const bigParty = $derived(party > MAX_ONLINE_PARTY);
	const availableSlots = $derived(slots.filter((s) => s.available));
	const prettyDate = $derived(
		new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		})
	);

	/** Step 1 → 2: advance from the date step to the party step. */
	function goToParty(e: SubmitEvent) {
		e.preventDefault();
		errorMsg = '';
		phase = 'party';
	}

	/** Step 2 → 3: look up availability for the chosen date + party. */
	async function findTables(e: SubmitEvent) {
		e.preventDefault();
		if (bigParty) return;
		loading = true;
		errorMsg = '';
		slots = [];
		selectedTime = '';
		try {
			const res = await fetch(`/api/availability?brand=${brand.id}&date=${date}&party=${party}`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			requiresPhone = data.requiresPhone;
			closed = data.closed ?? false;
			closureReason = data.closureReason ?? '';
			slots = data.slots;
			// WP-AVAIL-3: pin the date picker's max to the live horizon. The
			// availability response carries the window in DAYS; turn it into a date.
			const windowDays = data.bookingWindow?.windowDays ?? 0;
			if (windowDays > 0) {
				const d = new Date();
				d.setDate(d.getDate() + windowDays);
				maxDate = londonDay(d);
			}
			showWaitlist = false;
			phase = 'slot';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not load availability.';
		} finally {
			loading = false;
		}
	}

	/** Join the waitlist for a fully-booked, non-closed date (WP-AVAIL-5). */
	async function joinWaitlist(e: SubmitEvent) {
		e.preventDefault();
		if (!hasSurname(name)) {
			errorMsg = SURNAME_REQUIRED;
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/waitlist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					brand: brand.id,
					date,
					partySize: party,
					windowFrom: waitFrom,
					windowTo: waitTo,
					customer: { name, email, phone, marketingConsent: consent }
				})
			});
			if (!res.ok) throw new Error(await res.text());
			phase = 'waitlisted';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not join the waitlist.';
		} finally {
			loading = false;
		}
	}

	function chooseSlot(t: string) {
		selectedTime = t;
		phase = 'details';
	}

	// Re-run the deep-link prefill when the query string changes without a remount
	// (tapping a different time chip in the assistant while already on this page does
	// a client-side same-route nav). Only while still on the pre-booking steps, so a
	// booking in progress (details/payment/done) is never disrupted. lastQuery guards
	// against re-firing on unrelated URL updates.
	// Seed with the current search so the effect fires only on LATER changes; the
	// initial prefill is handled by onMount (avoids a double-run on first mount).
	let lastQuery = $state<string | null>(null);
	$effect(() => {
		const qs = page.url?.search ?? '';
		if (lastQuery === null) {
			lastQuery = qs;
			return;
		}
		if (qs === lastQuery) return;
		lastQuery = qs;
		const prebooking = phase === 'date' || phase === 'party' || phase === 'slot';
		if (prebooking && (qs.includes('date=') || qs.includes('time='))) {
			void prefillFromQuery();
		}
	});

	/** Deep-link prefill from the guest-assistant availability card
	 *  (/{brand}/bookings?date=&party=&time=). Seeds date/party, fetches slots and
	 *  advances the stepper as far as the params allow — landing on 'details' when a
	 *  valid &time= is still bookable, else 'slot' so the guest just picks a time.
	 *  Fully defensive: bad/partial params fall back to the normal empty flow. */
	async function prefillFromQuery() {
		const sp = page.url?.searchParams;
		if (!sp) return;
		const qDate = sp.get('date');
		const qParty = sp.get('party');
		const qTime = sp.get('time');

		// Only accept a well-formed future-ish date and a sane party size.
		if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate) && qDate >= today) date = qDate;
		else if (!qParty && !qTime) return; // nothing usable → leave the empty form

		const n = Number(qParty);
		if (Number.isFinite(n) && n >= 1 && n <= MAX_ONLINE_PARTY) party = n;

		// Look up availability for the seeded date/party (mirrors findTables without a
		// form event), then optionally pre-select the requested time.
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/availability?brand=${brand.id}&date=${date}&party=${party}`);
			if (!res.ok) return; // silent — the guest can still drive the form manually
			const data = await res.json();
			requiresPhone = data.requiresPhone;
			closed = data.closed ?? false;
			closureReason = data.closureReason ?? '';
			slots = data.slots ?? [];
			const windowDays = data.bookingWindow?.windowDays ?? 0;
			if (windowDays > 0) {
				const d = new Date();
				d.setDate(d.getDate() + windowDays);
				maxDate = londonDay(d);
			}
			if (closed) {
				phase = 'slot';
				return;
			}
			// A requested time that's still bookable → jump straight to details.
			const want = qTime ? hhmm(qTime) : '';
			if (want && slots.some((s) => hhmm(s.time) === want && s.available)) {
				selectedTime = slots.find((s) => hhmm(s.time) === want)!.time;
				phase = 'details';
			} else {
				phase = 'slot';
			}
		} catch {
			// leave the guest on whatever step they're on; the manual flow still works
		} finally {
			loading = false;
		}
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
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
					customer: { name, email, phone, marketingConsent: consent },
					occasion,
					specialRequests,
					...(setMenuId ? { preorder: setMenuId } : {})
				})
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			payment = data.payment;
			bookingId = data.booking?.id ?? '';
			bookingStatus = data.booking?.status ?? '';
			paymentSession = data.paymentSession ?? null;

			// Payment required → card-collection step. Otherwise we're confirmed.
			if (payment && payment.kind !== 'none' && paymentSession) {
				phase = 'payment';
			} else {
				phase = 'done';
			}
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not complete your booking.';
		} finally {
			loading = false;
		}
	}

	/** Where a hosted checkout would return the guest — back to this page.
	 *  DEAD with Stripe, which is inline-only; kept for the parked flow. */
	function returnUrl(): string {
		if (typeof window === 'undefined') return '';
		return `${window.location.origin}${window.location.pathname}?booking=${bookingId}`;
	}

	/** Hosted-URL-first. Unreachable on Stripe (inline-only) — see the note above. */
	function payNow() {
		if (paymentSession?.hostedUrl && typeof window !== 'undefined') {
			const url = new URL(paymentSession.hostedUrl);
			// Best-effort return URL so the guest lands back here after paying.
			if (!url.searchParams.has('redirectUrl')) {
				url.searchParams.set('redirectUrl', returnUrl());
			}
			window.location.href = url.toString();
		}
	}

	/**
	 * Poll the booking status (the webhook is the source of truth). Used after the
	 * guest returns from hosted checkout, or to confirm the manual-fallback path.
	 */
	async function refreshStatus() {
		if (!bookingId || polling) return;
		polling = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/bookings/${bookingId}/status`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			bookingStatus = data.booking?.status ?? bookingStatus;
			if (data.confirmed) phase = 'done';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not check your booking status.';
		} finally {
			polling = false;
		}
	}

	function reset() {
		phase = 'date';
		selectedTime = '';
		firstName = lastName = email = phone = occasion = specialRequests = '';
		setMenuId = '';
		consent = false;
		payment = null;
		bookingId = '';
		paymentSession = null;
		bookingStatus = '';
		errorMsg = '';
		closed = false;
		closureReason = '';
		showWaitlist = false;
	}
</script>

<section class="book" data-brand={brand.id}>
	<header class="head">
		<h1>Book a Table</h1>
		<p class="lead">{brand.name} · {brand.address.line1}, {brand.address.postcode}</p>
	</header>

	<div class="grid">
		<!-- FORM -->
		<div class="form-card">
			{#if inStepper}
				<!-- WP-S9-3 step indicator (1–5) -->
				<ol class="stepper" aria-label="Booking progress">
					{#each STEPS as s, i (s)}
						<li
							class="step"
							class:active={i === activeIndex}
							class:done={i < activeIndex}
							aria-current={i === activeIndex ? 'step' : undefined}
						>
							<span class="dot">{i + 1}</span>
							<span class="lbl">{stepLabels[s]}</span>
						</li>
					{/each}
				</ol>
			{/if}

			{#if phase === 'date'}
				<form onsubmit={goToParty} class="flow">
					<label>
						Date
						<input
							type="date"
							bind:value={date}
							min={today}
							max={maxDate || undefined}
							required
						/>
					</label>
					<button class="submit" type="submit">Continue</button>
					<p class="hint">Choose the day you'd like to dine, then your party size.</p>
					{#if errorMsg}<p class="bigparty">{errorMsg}</p>{/if}
				</form>
			{:else if phase === 'party'}
				<form onsubmit={findTables} class="flow">
					<p class="ctx">{prettyDate}</p>
					<div class="party-step">
						<span class="party-label">Guests</span>
						<div class="stepper-input">
							<button
								type="button"
								class="pm"
								aria-label="Fewer guests"
								onclick={() => (party = Math.max(1, party - 1))}
							>
								−
							</button>
							<input
								type="number"
								min="1"
								max={MAX_ONLINE_PARTY + 1}
								bind:value={party}
								required
								aria-label="Number of guests"
							/>
							<button
								type="button"
								class="pm"
								aria-label="More guests"
								onclick={() => (party = Math.min(MAX_ONLINE_PARTY + 1, party + 1))}
							>
								+
							</button>
						</div>
					</div>

					{#if bigParty}
						<p class="bigparty">
							For parties over {MAX_ONLINE_PARTY}, please call us on
							<a href="tel:{tel}">{brand.phone}</a> so we can look after you properly.
						</p>
					{:else}
						<button class="submit" type="submit" disabled={loading}>
							{loading ? 'Checking availability…' : 'Find a Table'}
						</button>
						<p class="hint">No availability shown means that day is fully booked.</p>
					{/if}
					{#if errorMsg}<p class="bigparty">{errorMsg}</p>{/if}
					<button type="button" class="again" onclick={() => (phase = 'date')}
						>← Change date</button
					>
				</form>
			{:else if phase === 'slot'}
				<div class="flow">
					<p class="ctx">{prettyDate} · {party} {party === 1 ? 'guest' : 'guests'}</p>
					{#if requiresPhone}
						<p class="bigparty">For parties over {MAX_ONLINE_PARTY}, please call <a href="tel:{tel}">{brand.phone}</a>.</p>
					{:else if closed}
						<p class="bigparty">
							{closureReason || 'We’re closed on this date.'} Please pick another day, or call
							<a href="tel:{tel}">{brand.phone}</a>.
						</p>
					{:else if availableSlots.length === 0}
						{#if showWaitlist}
							<form onsubmit={joinWaitlist} class="flow waitlist">
								<p class="bigparty">
									This date is fully booked. Join the waitlist and we’ll email you if a table frees up.
								</p>
								<div class="row">
									<label>
										From
										<input type="time" bind:value={waitFrom} required />
									</label>
									<label>
										Until
										<input type="time" bind:value={waitTo} min={waitFrom} required />
									</label>
								</div>
								<div class="row">
									<label>
										First name
										<input type="text" bind:value={firstName} required maxlength="60" autocomplete="given-name" />
									</label>
									<label>
										Surname
										<input type="text" bind:value={lastName} required maxlength="60" autocomplete="family-name" />
									</label>
								</div>
								<div class="row">
									<label>
										Phone
										<input type="tel" bind:value={phone} maxlength="40" />
									</label>
									<label>
										Email
										<input type="email" bind:value={email} required />
									</label>
								</div>
								<label class="consent">
									<input type="checkbox" bind:checked={consent} />
									Keep me updated with news &amp; offers.
								</label>
								{#if errorMsg}<p class="bigparty">{errorMsg}</p>{/if}
								<div class="actions">
									<button type="button" class="again" onclick={() => (showWaitlist = false)}>← Back</button>
									<button class="submit" type="submit" disabled={loading}>
										{loading ? 'Joining…' : 'Join the waitlist'}
									</button>
								</div>
							</form>
						{:else}
							<p class="bigparty">
								No availability for this date. Try another day, call <a href="tel:{tel}">{brand.phone}</a>,
								or join the waitlist.
							</p>
							<button class="submit" type="button" onclick={() => (showWaitlist = true)}>
								Join the waitlist
							</button>
						{/if}
					{:else}
						<div class="slotgrid">
							{#each availableSlots as s}
								<button class="slot" onclick={() => chooseSlot(s.time)}>{s.time}</button>
							{/each}
						</div>
					{/if}
					{#if !showWaitlist}
						<button class="again" onclick={() => (phase = 'party')}>← Change date or party</button>
					{/if}
				</div>
			{:else if phase === 'details'}
				<form onsubmit={submit} class="flow">
					<p class="ctx">{prettyDate} · {selectedTime} · {party} {party === 1 ? 'guest' : 'guests'}</p>
					<div class="row">
						<label>
							First name
							<input type="text" bind:value={firstName} required maxlength="60" autocomplete="given-name" />
						</label>
						<label>
							Surname
							<input type="text" bind:value={lastName} required maxlength="60" autocomplete="family-name" />
						</label>
					</div>
					<div class="row">
						<label>
							Phone
							<input type="tel" bind:value={phone} maxlength="40" />
						</label>
						<label>
							Email
							<input type="email" bind:value={email} required />
						</label>
					</div>
					<label>
						Occasion (optional)
						<input type="text" bind:value={occasion} maxlength="120" placeholder="Birthday, anniversary…" />
					</label>
					<label>
						Special requests (optional)
						<textarea bind:value={specialRequests} rows="2" maxlength="2000"></textarea>
					</label>
					{#if setMenus.length}
						<label>
							Pre-order a set menu (optional)
							<select bind:value={setMenuId}>
								<option value="">No pre-order — order on the night</option>
								{#each setMenus as m (m.id)}
									<option value={m.id}>
										{m.name} — {moneyGBP(m.pricePence)} pp{m.courses ? ` · ${m.courses}` : ''}
									</option>
								{/each}
							</select>
						</label>
					{/if}
					<label class="consent">
						<input type="checkbox" bind:checked={consent} />
						Keep me updated with news &amp; offers.
					</label>
					{#if errorMsg}<p class="bigparty">{errorMsg}</p>{/if}
					<div class="actions">
						<button type="button" class="again" onclick={() => (phase = 'slot')}>← Back</button>
						<button class="submit" type="submit" disabled={loading}>
							{loading ? 'Booking…' : 'Confirm Booking'}
						</button>
					</div>
				</form>
			{:else if phase === 'payment'}
				<div class="flow pay">
					<p class="ctx">{prettyDate} · {selectedTime} · {party} {party === 1 ? 'guest' : 'guests'}</p>
					<h2>{payment?.kind === 'deposit' ? 'Secure your table' : 'Confirm your card'}</h2>
					{#if payment}<p>{payment.reason}</p>{/if}

					{#if paymentSession?.mode === 'hosted' && paymentSession.hostedUrl}
						<p class="amt">
							{payment?.kind === 'deposit' ? 'Amount due now' : 'We’ll hold (not charge)'}:
							<strong>{moneyGBP(paymentSession.amountPence)}</strong>
						</p>
						<button class="submit" type="button" onclick={payNow}>
							Continue to secure payment →
						</button>
						<p class="hint">
							You’ll be taken to our payment provider, then returned here. Already paid?
							<button class="linkish" type="button" onclick={refreshStatus} disabled={polling}>
								{polling ? 'Checking…' : 'Check status'}
							</button>
						</p>
					{:else}
						<!-- inline secret without an SDK, or Stripe not yet configured: don't
						     block the guest. The booking is held; staff/webhook resolve it. -->
						<p>
							Thank you, {name || 'guest'}. Your table is reserved. We’ll confirm your
							reservation shortly{payment?.kind === 'deposit'
								? ' once your deposit is settled'
								: ''} and send the details to your email.
						</p>
						<p class="hint">
							For anything urgent, call <a href="tel:{tel}">{brand.phone}</a>.
							<button class="linkish" type="button" onclick={refreshStatus} disabled={polling}>
								{polling ? 'Checking…' : 'Refresh status'}
							</button>
						</p>
					{/if}
					{#if errorMsg}<p class="bigparty">{errorMsg}</p>{/if}
					<button class="again" onclick={reset}>Make another booking</button>
				</div>
			{:else if phase === 'waitlisted'}
				<div class="thanks">
					<h2>You’re on the waitlist</h2>
					<p class="ctx">{prettyDate} · {waitFrom}–{waitTo} · {party} {party === 1 ? 'guest' : 'guests'}</p>
					<p>
						Thank you, {name || 'guest'}. We’ll email you if a table frees up for this date within your
						chosen window. For anything urgent, call <a href="tel:{tel}">{brand.phone}</a>.
					</p>
					<button class="again" onclick={reset}>Make another booking</button>
				</div>
			{:else}
				<div class="thanks">
					<h2>{bookingStatus === 'confirmed' ? 'Table confirmed' : 'Table requested'}</h2>
					<p class="ctx">{prettyDate} · {selectedTime} · {party} {party === 1 ? 'guest' : 'guests'}</p>
					<p>
						Thank you, {name || 'guest'}. We’ve received your booking and a confirmation will be
						sent to your email. For anything urgent, call <a href="tel:{tel}">{brand.phone}</a>.
					</p>
					<button class="again" onclick={reset}>Make another booking</button>
				</div>
			{/if}
		</div>

		<!-- POLICY -->
		<aside class="policy">
			<!-- Opening hours from the LIVE bookable service periods — the same rows
			     that produce the slots on the left and that the admin diary runs on,
			     so the two can't disagree. Served with the page (no fetch), so it's
			     correct on first paint. -->
			<h2>Opening hours</h2>
			<ul class="hours">
				{#each liveHours.days as d (d.day)}
					<li>
						<span class="day">{d.day}</span>
						<span class="times">
							{#if d.periods.length}
								{#each d.periods as p, i (p.name + p.from)}
									{i > 0 ? ', ' : ''}{hhmm(p.from)}–{hhmm(p.to)}
								{/each}
							{:else}
								{d.display}
							{/if}
						</span>
					</li>
				{/each}
			</ul>
			{#if hoursNote}<p class="alt small">{hoursNote}</p>{/if}

			<h2 class="gtk">Good to know</h2>
			<ul>
				<li><strong>Up to 8 guests</strong> can book online. Larger? Call {brand.phone}.</li>
				<li>
					<strong>Fri &amp; Sat, 3–5 guests:</strong> a card is required. £5 per person applies for
					a no-show or late cancellation (under 12 hours’ notice).
				</li>
				<li>
					<strong>6+ guests, any day:</strong> a £10 per person deposit applies, deducted from your
					final bill. Non-refundable for no-shows or late cancellation.
				</li>
				<li>Tables are released 20 minutes after the booking time if we don’t hear from you.</li>
				<li><strong>Walk-ins welcome</strong> — we’ll seat you on a non-reservable table when we can.</li>
			</ul>
			<p class="alt">
				Prefer to talk to someone? Call <a href="tel:{brand.phone.replace(/\s/g, '')}">{brand.phone}</a>
				{#if brand.dishCultUrl}
					· or book via <a href={brand.dishCultUrl} target="_blank" rel="noopener noreferrer">Dish Cult</a>.
				{/if}
			</p>
		</aside>
	</div>
</section>

<style>
	.book {
		max-width: 1080px;
		margin: 0 auto;
		padding: 3rem 1.6rem 5rem;
		color: var(--ink);
		font-family: var(--font-serif);
	}
	.head {
		text-align: center;
		margin-bottom: 2.6rem;
	}
	h1 {
		font-size: clamp(2.6rem, 6vw, 4.2rem);
		margin: 0.3rem 0 0.4rem;
		font-weight: 500;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: 1.2fr 1fr;
		gap: 1.6rem;
		align-items: start;
	}
	.form-card,
	.policy {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 2rem 1.8rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-family: var(--font-sans);
		font-size: 0.74rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	input,
	textarea,
	select {
		font-family: var(--font-serif);
		font-size: 1.05rem;
		padding: 0.7rem 0.8rem;
		border-radius: 4px;
		border: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
		color: var(--ink);
		/* Native popups (the set-menu list) and pickers (the date field) are drawn by
		   the OS from the control's own colours — and this background is translucent,
		   which they can't composite. Without this the option list renders as light
		   ink on a light sheet. */
		color-scheme: dark;
	}
	select option {
		background-color: var(--bg-2);
		color: var(--ink);
	}
	input:focus,
	textarea:focus,
	select:focus {
		outline: none;
		border-color: var(--accent);
	}
	.flow {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.ctx {
		font-family: var(--font-sans);
		font-size: 0.75rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0;
	}

	/* WP-S9-3 step indicator */
	.stepper {
		list-style: none;
		display: flex;
		gap: 0.4rem;
		padding: 0;
		margin: 0 0 1.6rem;
		counter-reset: step;
	}
	.step {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		opacity: 0.5;
		transition: opacity 0.2s ease;
	}
	.step.active,
	.step.done {
		opacity: 1;
	}
	.step .dot {
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-family: var(--font-sans);
		font-size: 0.8rem;
		border: 1px solid var(--line);
		color: var(--ink-soft);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
	}
	.step.active .dot {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--bg);
	}
	.step.done .dot {
		border-color: var(--accent);
		color: var(--accent);
	}
	.step .lbl {
		font-family: var(--font-sans);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	/* Party stepper */
	.party-step {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		align-items: center;
		padding: 1rem 0;
	}
	.party-label {
		font-family: var(--font-sans);
		font-size: 0.74rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.stepper-input {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.stepper-input input {
		width: 4.5rem;
		text-align: center;
		font-size: 1.4rem;
	}
	.pm {
		width: 2.8rem;
		height: 2.8rem;
		border-radius: 50%;
		border: 1px solid var(--accent);
		background: transparent;
		color: var(--accent);
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.pm:hover {
		background: var(--accent);
		color: var(--bg);
	}

	.slotgrid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
		gap: 0.6rem;
	}
	.slot {
		font-family: var(--font-serif);
		font-size: 1.05rem;
		color: var(--ink);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
		border: 1px solid var(--line);
		border-radius: 4px;
		min-height: 44px;
		padding: 0.75rem 0;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.slot:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.consent {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		text-transform: none;
		letter-spacing: 0;
		font-family: var(--font-serif);
		font-size: 0.95rem;
		color: var(--ink-soft);
	}
	.consent input {
		width: auto;
	}
	.submit {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.15rem;
		padding: 0.9rem 1.4rem;
		border-radius: 4px;
		border: 0;
		background: var(--accent);
		color: var(--bg);
		cursor: pointer;
		transition: filter 0.2s ease;
	}
	.submit:hover {
		filter: brightness(1.06);
	}
	.hint,
	.bigparty {
		font-size: 0.95rem;
		font-style: italic;
		color: var(--ink-faint);
		margin: 0;
	}
	.bigparty a,
	.alt a,
	.thanks a {
		color: var(--accent);
	}
	.policy h2,
	.thanks h2 {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		color: var(--accent);
		font-weight: 500;
	}
	.policy ul {
		margin: 0;
		padding-left: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.policy li {
		font-size: 1rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}
	.policy strong {
		color: var(--ink);
	}
	.policy h2.gtk {
		margin-top: 1.8rem;
	}
	.hours {
		list-style: none;
		padding-left: 0;
	}
	.hours li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.hours .day {
		color: var(--ink);
	}
	.hours .times {
		color: var(--ink-soft);
		text-align: right;
	}
	.alt {
		margin: 1.4rem 0 0;
		font-size: 0.95rem;
		color: var(--ink-soft);
	}
	.alt.small {
		font-size: 0.85rem;
		font-style: italic;
		margin-top: 0.8rem;
	}
	.thanks {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.5rem 0;
	}
	.pay {
		gap: 0.9rem;
	}
	.pay h2 {
		margin: 0;
		font-size: 1.5rem;
		color: var(--accent);
		font-weight: 500;
	}
	.amt {
		font-size: 1.05rem;
		margin: 0;
		color: var(--ink-soft);
	}
	.amt strong {
		color: var(--ink);
	}
	.linkish {
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		font: inherit;
		font-style: italic;
		cursor: pointer;
		text-decoration: underline;
	}
	.linkish:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.again {
		align-self: center;
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
		padding: 0.6rem 1.2rem;
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--font-serif);
		font-style: italic;
	}

	@media (max-width: 760px) {
		/* minmax(0, …), not a bare 1fr: a grid track's floor is its content, and a
		   date input's intrinsic width would hold the card wider than the screen. */
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* Phone. Written from the source, not from a screen — this flow is parked
	   behind the ResDiary widget (see $lib/bookings/engine.ts) and can't be reached
	   on a production build. The desktop paddings stacked to ~55px a side, leaving
	   the form a 250px column on a 360px phone. */
	@media (max-width: 480px) {
		.book {
			padding: 2rem 1rem 4rem;
		}
		.head {
			margin-bottom: 1.6rem;
		}
		.form-card,
		.policy {
			padding: 1.4rem 1.15rem;
		}
		/* Two-up rows (names, phone/email, waitlist times): let the columns shrink
		   to the card instead of to their inputs. */
		.row label {
			min-width: 0;
		}
		input,
		textarea,
		select {
			box-sizing: border-box;
			width: 100%;
			min-width: 0;
		}
		/* 0.6rem is 9.6px. */
		.step .lbl {
			font-size: 0.68rem;
			letter-spacing: 0.05em;
		}
	}
</style>
