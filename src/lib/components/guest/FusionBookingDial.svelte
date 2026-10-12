<script lang="ts">
	// Fusion's bespoke booking flow — a rotary "reservation dial" of concentric
	// bezels (Date → Guests → Time) you SPIN like a rotary phone: grab a ring, turn
	// it, and whatever value lands under the top ▾ marker is your choice. It reuses
	// the homepage orbit vocabulary (a real dial, terracotta accents, Libre
	// Baskerville centre) and is wired to the SAME backend as the classic panel:
	//   GET  /api/availability  → real slots / closures / horizon
	//   POST /api/bookings      → createBooking(source:'online') + Stripe payment
	//   POST /api/waitlist      → waitlist a fully-booked, non-closed date
	//   GET  /api/hours         → live opening hours for the policy aside
	//
	// Progressive disclosure: only the active bezel is lit + spinnable; rings you
	// haven't reached are greyed; completed rings stay lit showing your pick. Time is
	// a two-turn ring: spin to an HOUR, then spin that hour's :00/:15/:30/:45.
	// Fusion-scoped styling only — Asia keeps the classic BookingPanel untouched.
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import type { Brand } from '$lib/data/brand';
	import type { PublicHours } from '$lib/hours';
	import { staticPublicHours } from '$lib/hours';
	import { hasSurname, joinGuestName, SURNAME_REQUIRED } from '$lib/guestName';

	let { brand }: { brand: Brand } = $props();

	type Slot = { time: string; available: boolean; unavailableReason?: string | null };
	/**
	 * Reasons a slot is off the table for good on this date — it has already started,
	 * or it sits beyond the forward booking window. Unlike 'full' / 'slot_cap' /
	 * 'period_cap' (a table might free up, and a struck tick tells the guest we DO
	 * run that sitting), these can never resolve, so they're dropped from the rings
	 * and the time list rather than shown crossed out.
	 */
	const OUT_OF_HORIZON = new Set(['too_soon', 'beyond_window']);
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
	const MAX_ONLINE_PARTY = 30;

	// ----- calendar helpers (local-time, no TZ drift) -------------------------
	const pad = (n: number) => String(n).padStart(2, '0');
	const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	// "Today" is the RESTAURANT'S day, not the device's — a guest booking from
	// Madrid at 00:30 is still on the previous London day, which is still open.
	// en-CA formats as 'YYYY-MM-DD'; the anchor Date is built at NOON so no DST
	// shift can push it onto a neighbouring day.
	const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
	const todayDate = new Date(`${today}T12:00:00`);

	// ===== machine ============================================================
	// Ring stages: 0=date 1=guests 2=time, then the panel takes over.
	type Step = 0 | 1 | 2;
	let step = $state<Step>(0);
	let phase = $state<'dial' | 'payment' | 'done' | 'waitlisted'>('dial');
	// Time ring sub-mode: pick the hour, then the minutes within it.
	let timeMode = $state<'hour' | 'minute'>('hour');

	let viewMonth = $state(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));

	// Selections
	let date = $state('');
	let party = $state(0);
	let selectedHour = $state<number | null>(null);
	let selectedTime = $state('');

	// Availability
	let slots = $state<Slot[]>([]);
	let closed = $state(false);
	let closureReason = $state('');
	/** Every sitting on this date has already started (see OUT_OF_HORIZON). */
	let dayOver = $state(false);
	let requiresPhone = $state(false);
	let maxDate = $state('');
	let loadingSlots = $state(false);

	// Details. Two name boxes, joined into one name on submit — see $lib/guestName.ts
	// for why a surname is required ("a table for 5 different Pauls").
	let firstName = $state('');
	let lastName = $state('');
	const name = $derived(joinGuestName(firstName, lastName));
	let email = $state('');
	let phone = $state('');
	let occasion = $state('');
	let specialRequests = $state('');
	let consent = $state(false);

	// Waitlist
	let waitFrom = $state('18:00');
	let waitTo = $state('21:00');

	// Submit / payment
	let submitting = $state(false);
	let errorMsg = $state('');
	let payment = $state<PaymentReq | null>(null);
	let paymentSession = $state<PaymentSession | null>(null);
	let bookingId = $state('');
	let bookingStatus = $state('');
	let polling = $state(false);

	// Opening hours from the LIVE service periods — the same rows that produce the
	// dial's slots and that the admin diary runs on. Served with the page by the
	// Fusion layout load (`data.hours`), so the panel is correct on first paint
	// instead of briefly showing static marketing copy while a fetch lands.
	const liveHours = $derived<PublicHours>(
		(page.data.hours as PublicHours | undefined) ??
			staticPublicHours(brand.id, brand.hours, brand.hoursNote ?? '')
	);
	const hoursNote = $derived(
		[liveHours.lastBookingNote, liveHours.note].filter(Boolean).join(' ')
	);

	const moneyGBP = (p: number) => `£${(p / 100).toFixed(2)}`;
	const hhmm = (t: string) => t.slice(0, 5);

	onMount(() => {
		// Start the date ring pointing at TODAY (not the 1st), so the marker + centre
		// read the soonest bookable day out of the box.
		const iToday = dateTicks.findIndex((t) => t.value === today);
		if (iToday >= 0) dateRot = rotForIndex(iToday, dateTicks.length);

		// Deep-link prefill from the guest-assistant availability card
		// (/fusion/bookings?date=&party=&time=). Spin the dial to the requested date,
		// party and (if bookable) time so the guest lands on the summary/details step
		// instead of an untouched dial. Fully defensive — bad params just leave the
		// dial at its default and the guest spins it themselves.
		void prefillFromQuery();
	});

	// If the guest taps a DIFFERENT time chip in the assistant while already on this
	// page, SvelteKit does a client-side nav (same route, new query) that does NOT
	// re-run onMount. Re-run the prefill when the query string actually changes — but
	// only while still on the dial (never mid-payment/done) so we don't disrupt a
	// booking in progress. `lastQuery` guards against re-firing on unrelated updates.
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
		if (phase === 'dial' && (qs.includes('date=') || qs.includes('time='))) {
			void prefillFromQuery();
		}
	});

	/** Prefill the dial from ?date=&party=&time= (the assistant's card link). */
	async function prefillFromQuery() {
		const sp = page.url?.searchParams;
		if (!sp) return;
		const qDate = sp.get('date');
		const qParty = sp.get('party');
		const qTime = sp.get('time');
		if (!qDate && !qParty && !qTime) return;

		// Date: must be a valid, still-bookable tick on the ring. The ring only carries
		// ~31 days, so page it to the linked date's month first (same rule as the panel's
		// date field) — otherwise a link more than a month out silently did nothing.
		if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate) && qDate >= today) {
			if (!dateTicks.some((t) => t.value === qDate)) {
				const d = new Date(`${qDate}T12:00:00`);
				viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
			}
			const di = dateTicks.findIndex((t) => t.value === qDate && t.enabled);
			if (di >= 0) {
				date = qDate;
				dateRot = rotForIndex(di, dateTicks.length);
				if (step < 1) step = 1;
			}
		}
		// Party: clamp to a valid guest tick.
		const n = Number(qParty);
		if (Number.isFinite(n) && n >= 1 && n <= MAX_ONLINE_PARTY) {
			party = n;
			const gi = guestTicks.findIndex((t) => Number(t.value) === n);
			if (gi >= 0) guestRot = rotForIndex(gi, guestTicks.length);
			if (date && step < 2) step = 2;
		}
		if (!date || party < 1) return;

		// Load real slots, then pre-select the requested time if it's still bookable.
		await loadAvailability();
		await tick(); // let hourTicks/minuteTicks recompute against the new slots
		const want = qTime ? hhmm(qTime) : '';
		if (!want) return;
		if (!slots.some((s) => hhmm(s.time) === want && s.available)) return;

		const [h] = want.split(':').map(Number);
		selectedHour = h;
		timeMode = 'minute';
		await tick();
		// minuteTicks value is the FULL slot time (may carry seconds) — compare on HH:MM.
		const mi = minuteTicks.findIndex((m) => hhmm(String(m.value)) === want && m.enabled);
		if (mi >= 0) {
			timeRot = rotForIndex(mi, minuteTicks.length);
			selectedTime = String(minuteTicks[mi].value); // summaryReady → details/summary shows
		} else {
			// Time vanished between availability and tick — fall back to the hour ring.
			timeMode = 'hour';
			selectedHour = null;
		}
	}

	// ===== SVG geometry — one viewBox, three concentric bezels ================
	const CX = 160;
	const CY = 160;
	const R_DATE = 132; // outer
	const R_GUEST = 96; // middle
	const R_TIME = 60; // inner
	// Per-ring band half-thickness for hit-testing a pointer to a ring.
	const BAND = { date: 22, guest: 22, time: 26 };
	const polar = (r: number, deg: number) => {
		const a = (deg * Math.PI) / 180;
		return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
	};
	// Radial tick mark (graduation) from r0 to r1 at an angle.
	const tickPath = (r0: number, r1: number, deg: number) => {
		const a = polar(r0, deg);
		const b = polar(r1, deg);
		return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} L${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
	};
	// Arc along radius r from a→b degrees. Used for the "window" that frames the
	// value under the marker and for the curved turn-me hint arrows.
	const arcPath = (r: number, a: number, b: number) => {
		const p0 = polar(r, a);
		const p1 = polar(r, b);
		const large = Math.abs(b - a) > 180 ? 1 : 0;
		const sweep = b > a ? 1 : 0;
		return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r} ${r} 0 ${large} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
	};
	// Transform that plants a small arrowhead at (r, deg) aimed along the ring's
	// tangent: dir +1 = clockwise, −1 = anticlockwise.
	const headAt = (r: number, deg: number, dir: 1 | -1) => {
		const p = polar(r, deg);
		return `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${deg + dir * 90})`;
	};
	// Half-width (deg) of the marker window on a ring of n items — one item wide,
	// clamped so a 31-day ring doesn't get a hairline slot and a 3-slot ring doesn't
	// get a window half the dial.
	const windowHalf = (n: number) => Math.min(13, Math.max(5.2, (360 / Math.max(n, 1)) * 0.46));

	// ===== ring model =========================================================
	// Each ring is a list of {value,label,enabled}. The item at index i sits at
	// baseAngle(i) = i*seg - 90 (so index 0 is at the top ▾). A live rotation
	// `*Rot` (degrees) spins the whole ring; the SELECTED item is whichever lands
	// under the marker. Labels counter-rotate by -*Rot to stay upright.
	type Tick = { key: string; label: string; value: string | number; enabled: boolean };

	/**
	 * The DATE bezel used to carry the view month WHOLE, every day of it, with the
	 * past struck through. On the 30th that meant 29 of 31 ticks were dead and the
	 * dial read as broken ("why is everything crossed out?"). It now starts at the
	 * first BOOKABLE day in view — today for the current month, the 1st for any
	 * later one — so a struck tick only ever means "past our booking window".
	 *
	 * When starting there would leave a stub (fewer than MIN_MONTH_TAIL days to
	 * month end) the ring rolls on into the next month rather than degenerating
	 * into a two-tick dial. Labels stay unique because a roll-on is at most
	 * RING_DAYS − MIN_MONTH_TAIL = 10 days past the month end, well under 28.
	 */
	const RING_DAYS = 31;
	const MIN_MONTH_TAIL = 21;
	const dateTicks = $derived.by<Tick[]>(() => {
		const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
		const start = iso(monthStart) < today ? new Date(todayDate) : monthStart;
		// Days from `start` to the end of the view month (only meaningful while the
		// two are in the same month — they always are, bar a page left open past
		// midnight into a new month, which falls back to a full ring).
		const inViewMonth =
			start.getFullYear() === viewMonth.getFullYear() && start.getMonth() === viewMonth.getMonth();
		const monthEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
		const tail = inViewMonth ? monthEnd - start.getDate() + 1 : RING_DAYS;
		const n = tail >= MIN_MONTH_TAIL ? tail : RING_DAYS;
		const out: Tick[] = [];
		for (let i = 0; i < n; i++) {
			const cell = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
			const ds = iso(cell);
			out.push({
				key: ds,
				label: pad(cell.getDate()),
				value: ds,
				enabled: ds >= today && (!maxDate || ds <= maxDate)
			});
		}
		return out;
	});

	const PARTY_MAX_RING = 12;
	const guestTicks = $derived.by<Tick[]>(() =>
		Array.from({ length: PARTY_MAX_RING }, (_, i) => ({
			key: `g${i + 1}`,
			label: String(i + 1),
			value: i + 1,
			enabled: true
		}))
	);

	// Distinct bookable hours from the returned slots (hour has ≥1 available slot).
	const hourTicks = $derived.by<Tick[]>(() => {
		const byHour = new Map<number, boolean>();
		for (const s of slots) {
			const h = Number(s.time.slice(0, 2));
			byHour.set(h, (byHour.get(h) ?? false) || s.available);
		}
		return [...byHour.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([h, ok]) => ({ key: `h${h}`, label: pad(h), value: h, enabled: ok }));
	});

	// Quarter slots within the chosen hour.
	const minuteTicks = $derived.by<Tick[]>(() => {
		if (selectedHour == null) return [];
		return slots
			.filter((s) => Number(s.time.slice(0, 2)) === selectedHour)
			.map((s) => ({ key: s.time, label: s.time.slice(3), value: s.time, enabled: s.available }));
	});

	// The active time ring depends on the sub-mode.
	const timeTicks = $derived(timeMode === 'hour' ? hourTicks : minuteTicks);

	// ===== live rotation state ================================================
	// Committed rotations (degrees). Drag updates a *DragRot; on release we snap
	// and fold it into the committed value + commit the selection.
	let dateRot = $state(0);
	let guestRot = $state(0);
	let timeRot = $state(0);

	// Index of the item currently under the marker for a given ring rotation.
	const indexAtMarker = (rot: number, n: number) => {
		if (n === 0) return 0;
		const seg = 360 / n;
		// item i is at (i*seg - 90 + rot); we want that ≈ -90 (top), i.e. i*seg+rot ≈ 0
		let idx = Math.round(-rot / seg) % n;
		if (idx < 0) idx += n;
		return idx;
	};
	// Rotation that brings item i to the top marker.
	const rotForIndex = (i: number, n: number) => (n === 0 ? 0 : -(i * (360 / n)));

	const dateAtMarker = $derived(dateTicks[indexAtMarker(dateRot, dateTicks.length)]);
	const guestAtMarker = $derived(guestTicks[indexAtMarker(guestRot, guestTicks.length)]);
	const timeAtMarker = $derived(timeTicks[indexAtMarker(timeRot, timeTicks.length)]);

	// ===== availability =======================================================
	const anyTimeFree = $derived(slots.some((s) => s.available));
	const bigParty = $derived(party > MAX_ONLINE_PARTY);
	// `date && party` guard: the panel controls let you set guests before a date, so
	// step can reach 2 with nothing to look up yet — that's "not asked", not "full".
	const asked = $derived(!!date && party > 0);
	const dayFullyBooked = $derived(
		asked && step >= 2 && !loadingSlots && !closed && slots.length > 0 && !anyTimeFree
	);
	const noSlotsAtAll = $derived(
		asked && step >= 2 && !loadingSlots && !closed && slots.length === 0 && !dayOver
	);
	/** Today's sittings have all started — a different, and non-waitlistable, empty. */
	const dayGone = $derived(asked && step >= 2 && !loadingSlots && !closed && dayOver);
	const canWaitlist = $derived(
		(dayFullyBooked || noSlotsAtAll) && !closed && !bigParty && !dayOver
	);

	async function loadAvailability() {
		if (!date || party < 1) return;
		loadingSlots = true;
		errorMsg = '';
		slots = [];
		closed = false;
		closureReason = '';
		dayOver = false;
		selectedHour = null;
		selectedTime = '';
		timeMode = 'hour';
		timeRot = 0;
		try {
			const res = await fetch(`/api/availability?brand=${brand.id}&date=${date}&party=${party}`);
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			requiresPhone = data.requiresPhone;
			closed = data.closed ?? false;
			closureReason = data.closureReason ?? '';
			const raw = (data.slots ?? []) as Slot[];
			slots = raw.filter(
				(s) => s.available || !OUT_OF_HORIZON.has(s.unavailableReason ?? '')
			);
			// The service ran today, but every sitting of it is behind us. That is NOT
			// "fully booked" and there is nothing to waitlist for — say so instead.
			dayOver = raw.length > 0 && slots.length === 0;
			const windowDays = data.bookingWindow?.windowDays ?? 0;
			if (windowDays > 0) {
				const d = new Date();
				d.setDate(d.getDate() + windowDays);
				maxDate = iso(d);
			}
			// Start the hour ring on the FIRST BOOKABLE hour, not a leading sold-out one,
			// so the marker lands on something the guest can actually pick.
			const firstHour = hourTicks.findIndex((h) => h.enabled);
			timeRot = firstHour >= 0 ? rotForIndex(firstHour, hourTicks.length) : 0;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not load availability.';
		} finally {
			loadingSlots = false;
		}
	}

	// ===== commit helpers (called on drag-release / keyboard) =================
	function commitDate() {
		const t = dateAtMarker;
		if (!t || !t.enabled) {
			// snapped onto a disabled day — bounce to nearest enabled, else no-op
			const alt = nearestEnabled(dateTicks, indexAtMarker(dateRot, dateTicks.length));
			if (alt < 0) return;
			dateRot = rotForIndex(alt, dateTicks.length);
		}
		const picked = dateTicks[indexAtMarker(dateRot, dateTicks.length)];
		if (!picked?.enabled) return;
		date = String(picked.value);
		if (step < 1) step = 1;
		if (party > 0) void loadAvailability();
	}
	function commitGuest() {
		const picked = guestTicks[indexAtMarker(guestRot, guestTicks.length)];
		if (!picked) return;
		party = Number(picked.value);
		if (step < 2) step = 2;
		selectedTime = '';
		selectedHour = null;
		timeMode = 'hour';
		timeRot = 0;
		if (date) void loadAvailability();
	}
	function commitTime() {
		const picked = timeTicks[indexAtMarker(timeRot, timeTicks.length)];
		if (!picked || !picked.enabled) {
			const alt = nearestEnabled(timeTicks, indexAtMarker(timeRot, timeTicks.length));
			if (alt < 0) return;
			timeRot = rotForIndex(alt, timeTicks.length);
		}
		const p = timeTicks[indexAtMarker(timeRot, timeTicks.length)];
		if (!p?.enabled) return;
		if (timeMode === 'hour') {
			selectedHour = Number(p.value);
			timeMode = 'minute';
			timeRot = 0; // reset for the minute ring
			// auto-point at the first available minute
			queueMicrotask(() => {
				const firstOk = minuteTicks.findIndex((m) => m.enabled);
				if (firstOk >= 0) timeRot = rotForIndex(firstOk, minuteTicks.length);
			});
		} else {
			selectedTime = String(p.value);
		}
	}
	function backToHours() {
		timeMode = 'hour';
		selectedTime = '';
		// restore the hour ring pointing at the previously chosen hour
		const i = hourTicks.findIndex((h) => Number(h.value) === selectedHour);
		timeRot = i >= 0 ? rotForIndex(i, hourTicks.length) : 0;
		selectedHour = null;
	}
	function nearestEnabled(ticks: Tick[], from: number): number {
		const n = ticks.length;
		for (let d = 0; d < n; d++) {
			const a = (from + d) % n;
			const b = (from - d + n) % n;
			if (ticks[a]?.enabled) return a;
			if (ticks[b]?.enabled) return b;
		}
		return -1;
	}

	// ===== panel controls → dial ==============================================
	// Not everyone will realise the bezels spin, so the summary panel on the right
	// is a full set of ordinary form controls. Each one SPINS the matching ring to
	// the value it just set (and runs the same downstream work as a hand-spin), so
	// the dial visibly demonstrates the mechanic instead of sitting there ignored.

	/** Rings the guest has moved at least once — used to retire the "turn me" arrows. */
	let spun = $state({ date: false, guest: false, time: false });

	/** Spin `id` so tick `i` lands under the marker, and mark the ring as used. */
	function spinTo(id: RingId, i: number, ticks: Tick[]) {
		setRot(id, rotForIndex(i, ticks.length));
		spun[id] = true;
	}

	function setDateFromPanel(ds: string) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) || ds < today || (maxDate && ds > maxDate)) return;
		// The ring only carries the days on show, so page to the date's month FIRST if
		// it isn't already on the dial — dateTicks derives off viewMonth, so it
		// recomputes before the lookup below. (A date in the ring's roll-on into the
		// next month is already there and needs no page.)
		if (!dateTicks.some((t) => t.value === ds)) {
			const d = new Date(`${ds}T12:00:00`);
			viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
		}
		const i = dateTicks.findIndex((t) => t.value === ds && t.enabled);
		if (i < 0) return;
		spinTo('date', i, dateTicks);
		date = ds;
		if (step < 1) step = 1;
		if (party > 0) void loadAvailability();
	}

	function setPartyFromPanel(n: number) {
		if (!Number.isFinite(n)) return;
		const want = Math.min(PARTY_MAX_RING, Math.max(1, Math.round(n)));
		const i = guestTicks.findIndex((t) => Number(t.value) === want);
		if (i < 0) return;
		spinTo('guest', i, guestTicks);
		party = want;
		// Party changed → any earlier time pick is stale.
		selectedTime = '';
		selectedHour = null;
		timeMode = 'hour';
		timeRot = 0;
		// Keep the focus ring on the date while there's still no date to look up.
		if (!date) step = 0;
		else if (step < 2) step = 2;
		if (date) void loadAvailability();
	}

	function setTimeFromPanel(t: string) {
		if (!t || !slots.some((s) => s.time === t && s.available)) return;
		selectedHour = Number(t.slice(0, 2));
		timeMode = 'minute';
		// minuteTicks derives off selectedHour, so it's already the right hour's list.
		const i = minuteTicks.findIndex((m) => String(m.value) === t);
		if (i < 0) {
			timeMode = 'hour';
			selectedHour = null;
			return;
		}
		spinTo('time', i, minuteTicks);
		selectedTime = t;
		step = 2;
	}

	/** Bookable slots grouped by hour, for the panel's time <select>. */
	const timeOptions = $derived.by(() => {
		const byHour = new Map<number, Slot[]>();
		for (const s of slots) {
			const h = Number(s.time.slice(0, 2));
			const list = byHour.get(h);
			if (list) list.push(s);
			else byHour.set(h, [s]);
		}
		return [...byHour.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([h, list]) => ({ hour: pad(h), slots: list }));
	});

	/** What the time control says when there's nothing to choose from yet. */
	const timePlaceholder = $derived.by(() => {
		if (!date) return 'Choose a date first';
		if (party < 1) return 'Choose guests first';
		if (loadingSlots) return 'Finding tables…';
		if (closed) return 'Closed this date';
		if (dayOver) return 'No sittings left today';
		if (!timeOptions.length) return 'No times available';
		if (!anyTimeFree) return 'Fully booked';
		return 'Choose a time';
	});

	// ===== rotary drag ========================================================
	// Which ring is currently grabbable depends on the step.
	type RingId = 'date' | 'guest' | 'time';
	// The "focus" ring — the deepest one the guest has reached, used for the centre
	// readout, keyboard control, and the live accent styling. NOT a lock: earlier
	// rings you've already set stay fully spinnable (see `unlockedRings`).
	const activeRing = $derived.by<RingId | null>(() => {
		if (phase !== 'dial') return null;
		if (step === 0) return 'date';
		if (step === 1) return 'guest';
		if (step === 2 && !closed && anyTimeFree) return 'time';
		return null;
	});

	// Every ring the guest may grab & re-spin right now. Once you've reached a ring
	// it never re-locks — so you can always go back and change an earlier choice by
	// grabbing its bezel again (changing it re-runs everything downstream).
	const unlockedRings = $derived.by<Set<RingId>>(() => {
		const s = new Set<RingId>();
		if (phase !== 'dial') return s;
		s.add('date'); // date is always changeable
		if (step >= 1 || party > 0) s.add('guest'); // guests changeable once reached/set
		if (step >= 2 && !closed && anyTimeFree) s.add('time'); // time when there are slots
		return s;
	});

	let svgEl = $state<SVGSVGElement>();
	let dragging = $state<RingId | null>(null);
	let dragStartAngle = 0;
	let dragStartRot = 0;

	// Pointer angle (deg) relative to the dial centre, in the SVG's own coord space.
	function pointerAngle(ev: PointerEvent): number {
		const svg = svgEl;
		if (!svg) return 0;
		const rect = svg.getBoundingClientRect();
		// map client px → viewBox units (viewBox is 320×320)
		const x = ((ev.clientX - rect.left) / rect.width) * 320;
		const y = ((ev.clientY - rect.top) / rect.height) * 320;
		return (Math.atan2(y - CY, x - CX) * 180) / Math.PI;
	}
	function pointerRadius(ev: PointerEvent): number {
		const svg = svgEl;
		if (!svg) return 0;
		const rect = svg.getBoundingClientRect();
		const x = ((ev.clientX - rect.left) / rect.width) * 320;
		const y = ((ev.clientY - rect.top) / rect.height) * 320;
		return Math.hypot(x - CX, y - CY);
	}
	const ringRadius = (id: RingId) => (id === 'date' ? R_DATE : id === 'guest' ? R_GUEST : R_TIME);
	const ringBand = (id: RingId) =>
		id === 'date' ? BAND.date : id === 'guest' ? BAND.guest : BAND.time;
	const getRot = (id: RingId) => (id === 'date' ? dateRot : id === 'guest' ? guestRot : timeRot);
	const setRot = (id: RingId, v: number) => {
		if (id === 'date') dateRot = v;
		else if (id === 'guest') guestRot = v;
		else timeRot = v;
	};

	function onPointerDown(ev: PointerEvent) {
		if (unlockedRings.size === 0) return;
		const r = pointerRadius(ev);
		// Grab whichever UNLOCKED ring's bezel the pointer is over (closest by radius),
		// so a completed ring can be re-grabbed to change an earlier choice.
		let best: RingId | null = null;
		let bestDist = Infinity;
		for (const id of ['date', 'guest', 'time'] as RingId[]) {
			if (!unlockedRings.has(id)) continue;
			const d = Math.abs(r - ringRadius(id));
			if (d <= ringBand(id) && d < bestDist) {
				best = id;
				bestDist = d;
			}
		}
		if (!best) return;
		dragging = best;
		dragStartAngle = pointerAngle(ev);
		dragStartRot = getRot(best);
		try {
			(ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
		} catch {
			// no active pointer (e.g. synthetic event) — capture is best-effort
		}
		ev.preventDefault();
	}
	function onPointerMove(ev: PointerEvent) {
		if (!dragging) return;
		const delta = pointerAngle(ev) - dragStartAngle;
		setRot(dragging, dragStartRot + delta);
	}
	function endDrag(ev: PointerEvent) {
		if (!dragging) return;
		const id = dragging;
		dragging = null;
		try {
			(ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId);
		} catch {
			// best-effort — see setPointerCapture note above
		}
		// snap the ring so the nearest item sits exactly under the marker
		const ticks = id === 'date' ? dateTicks : id === 'guest' ? guestTicks : timeTicks;
		const idx = indexAtMarker(getRot(id), ticks.length);
		setRot(id, rotForIndex(idx, ticks.length));
		spun[id] = true; // they've got the idea — retire this ring's "turn me" arrows
		if (id === 'date') commitDate();
		else if (id === 'guest') commitGuest();
		else commitTime();
	}

	// Keyboard fallback: focus the dial, arrow keys step the active ring, Enter commits.
	function nudge(dir: 1 | -1) {
		const id = activeRing;
		if (!id) return;
		const ticks = id === 'date' ? dateTicks : id === 'guest' ? guestTicks : timeTicks;
		let idx = indexAtMarker(getRot(id), ticks.length);
		const n = ticks.length;
		// step to the next ENABLED item in that direction
		for (let k = 1; k <= n; k++) {
			const cand = (idx + dir * k + n * 10) % n;
			if (ticks[cand]?.enabled) {
				idx = cand;
				break;
			}
		}
		setRot(id, rotForIndex(idx, ticks.length));
		spun[id] = true;
	}
	function onKey(ev: KeyboardEvent) {
		if (!activeRing) return;
		if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
			ev.preventDefault();
			nudge(1);
		} else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
			ev.preventDefault();
			nudge(-1);
		} else if (ev.key === 'Enter' || ev.key === ' ') {
			ev.preventDefault();
			const id = activeRing;
			if (id === 'date') commitDate();
			else if (id === 'guest') commitGuest();
			else commitTime();
		}
	}

	// ===== month pager (drives the DATE ring's available range) ================
	// The ring can roll past the end of the view month (see dateTicks), so the label
	// names what's actually ON the dial rather than the anchor month.
	const monthLabel = $derived.by(() => {
		const first = dateTicks[0];
		const last = dateTicks[dateTicks.length - 1];
		if (!first || !last) {
			return viewMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
		}
		const a = new Date(`${first.value}T12:00:00`);
		const b = new Date(`${last.value}T12:00:00`);
		if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
			return a.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
		}
		const from = a.toLocaleDateString('en-GB', { month: 'short' });
		const to = b.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
		return `${from} – ${to}`;
	});
	const canPrevMonth = $derived(
		viewMonth > new Date(todayDate.getFullYear(), todayDate.getMonth(), 1)
	);
	const canNextMonth = $derived.by(() => {
		if (!maxDate) return true;
		return iso(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)) <= maxDate;
	});
	function prevMonth() {
		if (!canPrevMonth) return;
		viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
		dateRot = 0;
	}
	function nextMonth() {
		if (!canNextMonth) return;
		viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
		dateRot = 0;
	}

	// ===== labels / summary ===================================================
	const prettyDate = $derived(
		date
			? new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', {
					weekday: 'long',
					day: 'numeric',
					month: 'long'
				})
			: ''
	);
	const summaryReady = $derived(!!date && !!selectedTime && party > 0);

	// Centre-of-dial prompt.
	const centre = $derived.by(() => {
		if (step === 0)
			return {
				hint: 'Turn to a date',
				main: dateAtMarker ? fmtDay(dateAtMarker.value as string) : 'Date'
			};
		if (step === 1)
			return {
				hint: 'Turn to your party',
				main: guestAtMarker
					? `${guestAtMarker.label} ${Number(guestAtMarker.label) === 1 ? 'guest' : 'guests'}`
					: 'Guests'
			};
		// step 2
		if (closed) return { hint: prettyDate, main: 'Closed' };
		if (loadingSlots) return { hint: prettyDate, main: 'Finding tables…' };
		if (dayGone) return { hint: prettyDate, main: 'That’s us for today' };
		if (dayFullyBooked || noSlotsAtAll) return { hint: prettyDate, main: 'Fully booked' };
		if (timeMode === 'hour')
			return { hint: 'Turn to an hour', main: timeAtMarker ? `${timeAtMarker.label}:00` : 'Time' };
		return {
			hint: `${selectedHour != null ? pad(selectedHour) : ''}:00 hour`,
			main: timeAtMarker ? String(timeAtMarker.value) : 'Time'
		};
	});
	function fmtDay(ds: string) {
		return new Date(`${ds}T12:00:00`).toLocaleDateString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
	}

	// upright counter-rotation for each label
	const upright = (x: number, y: number, rot: number) => `rotate(${-rot} ${x} ${y})`;

	// Index of TODAY within the currently-shown month's date ring (−1 if this month
	// isn't the current one). Used to pip today on the dial.
	const todayIndex = $derived(dateTicks.findIndex((t) => t.value === today));
	const todayPip = $derived.by(() => {
		if (todayIndex < 0) return null;
		const seg = 360 / (dateTicks.length || 1);
		return polar(R_DATE - 20, todayIndex * seg - 90);
	});

	// Show the curved "turn me" arrows only while the live ring is still untouched.
	const showSpinHint = $derived(!!activeRing && !spun[activeRing] && !dragging);

	// ARIA slider values reflecting the active ring's current index.
	const activeTicks = $derived(
		activeRing === 'date'
			? dateTicks
			: activeRing === 'guest'
				? guestTicks
				: activeRing === 'time'
					? timeTicks
					: []
	);
	const activeRot = $derived(
		activeRing === 'date' ? dateRot : activeRing === 'guest' ? guestRot : timeRot
	);
	const ariaNow = $derived(activeTicks.length ? indexAtMarker(activeRot, activeTicks.length) : 0);
	const ariaMax = $derived(Math.max(0, activeTicks.length - 1));

	// ===== submit / payment / waitlist (unchanged wiring) =====================
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!summaryReady) return;
		if (!hasSurname(name)) {
			errorMsg = SURNAME_REQUIRED;
			return;
		}
		submitting = true;
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
					specialRequests
				})
			});
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			payment = data.payment;
			bookingId = data.booking?.id ?? '';
			bookingStatus = data.booking?.status ?? '';
			paymentSession = data.paymentSession ?? null;
			if (payment && payment.kind !== 'none' && paymentSession) phase = 'payment';
			else phase = 'done';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not complete your booking.';
		} finally {
			submitting = false;
		}
	}

	async function joinWaitlist(e: SubmitEvent) {
		e.preventDefault();
		if (!hasSurname(name)) {
			errorMsg = SURNAME_REQUIRED;
			return;
		}
		submitting = true;
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
			submitting = false;
		}
	}

	function returnUrl(): string {
		if (typeof window === 'undefined') return '';
		return `${window.location.origin}${window.location.pathname}?booking=${bookingId}`;
	}
	function payNow() {
		if (paymentSession?.hostedUrl && typeof window !== 'undefined') {
			const url = new URL(paymentSession.hostedUrl);
			if (!url.searchParams.has('redirectUrl')) url.searchParams.set('redirectUrl', returnUrl());
			window.location.href = url.toString();
		}
	}
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
		phase = 'dial';
		step = 0;
		timeMode = 'hour';
		date = '';
		party = 0;
		selectedHour = null;
		selectedTime = '';
		dateRot = guestRot = timeRot = 0;
		slots = [];
		closed = false;
		closureReason = '';
		firstName = lastName = email = phone = occasion = specialRequests = '';
		consent = false;
		payment = null;
		paymentSession = null;
		bookingId = '';
		bookingStatus = '';
		errorMsg = '';
	}

	// Ring render descriptor for the template.
	type RingView = {
		id: RingId;
		r: number;
		ticks: Tick[];
		rot: number;
		active: boolean;
		locked: boolean;
		done: boolean;
		fontClass: string;
	};
	const rings = $derived.by<RingView[]>(() => [
		{
			id: 'date',
			r: R_DATE,
			ticks: dateTicks,
			rot: dateRot,
			active: activeRing === 'date',
			// "locked" = not yet reachable (greys out + no drag). A ring you've already
			// set is NOT locked — it stays grabbable so you can change it.
			locked: !unlockedRings.has('date'),
			done: !!date && activeRing !== 'date',
			fontClass: ''
		},
		{
			id: 'guest',
			r: R_GUEST,
			ticks: guestTicks,
			rot: guestRot,
			active: activeRing === 'guest',
			locked: !unlockedRings.has('guest'),
			done: party > 0 && activeRing !== 'guest',
			fontClass: ''
		},
		{
			id: 'time',
			r: R_TIME,
			ticks: timeTicks,
			rot: timeRot,
			active: activeRing === 'time',
			locked: !unlockedRings.has('time'),
			done: !!selectedTime && activeRing !== 'time',
			fontClass: 'tick-xs'
		}
	]);
</script>

<section class="dial-book" data-brand={brand.id}>
	<header class="head">
		<span class="kicker">Reservations</span>
		<h1>Book a Table</h1>
		<p class="lead">{brand.name} · {brand.address.line1}, {brand.address.postcode}</p>
	</header>

	<div class="layout">
		<!-- ===== LEFT: the rotary dial ===== -->
		<div class="stage">
			{#if phase === 'dial'}
				<div class="dial">
					<svg
						bind:this={svgEl}
						viewBox="0 0 320 320"
						class="rings"
						class:grabbing={!!dragging}
						role="slider"
						tabindex="0"
						aria-label={step === 0
							? 'Date dial — turn to choose a day'
							: step === 1
								? 'Guests dial — turn to choose party size'
								: 'Time dial — turn to choose a time'}
						aria-valuetext={centre.main}
						aria-valuenow={ariaNow}
						aria-valuemin={0}
						aria-valuemax={ariaMax}
						onpointerdown={onPointerDown}
						onpointermove={onPointerMove}
						onpointerup={endDrag}
						onpointercancel={endDrag}
						onkeydown={onKey}
					>
						<!-- bezel backplates -->
						{#each rings as ring (ring.id)}
							<circle
								class="bezel"
								class:is-active={ring.active}
								class:is-locked={ring.locked}
								class:is-done={ring.done}
								cx={CX}
								cy={CY}
								r={ring.r}
							/>
						{/each}

						<!-- Selection "window": a one-value-wide lit slot at the top of each live
						     ring. The chosen number sits framed inside it — replaces the old
						     pointer line, which ran straight through the numbers. Drawn before the
						     rings so the labels stay on top of it. -->
						{#each rings as ring (ring.id)}
							{#if ring.active || ring.done}
								{@const w = windowHalf(ring.ticks.length)}
								<path
									class="win"
									class:is-done={!ring.active}
									d={arcPath(ring.r, -90 - w, -90 + w)}
								/>
							{/if}
						{/each}

						<!-- Top marker: a small chevron sitting ABOVE the outer bezel, pointing
						     down into the window. Deliberately clear of the numbers. -->
						<path class="marker" d="M160 16.5 l7.5 -13 h-15 z" />

						<!-- rings: graduations + labels -->
						{#each rings as ring (ring.id)}
							{@const n = ring.ticks.length || 1}
							{@const seg = 360 / n}
							<!-- The wrapper carries the one-off "I turn" nudge animation, so it can't
							     fight the live drag rotation set on .ring itself. -->
							<g
								class="ring-wrap"
								class:nudge={ring.active && !spun[ring.id] && dragging !== ring.id}
							>
								<g
									class="ring ring-{ring.id}"
									class:is-active={ring.active}
									class:is-locked={ring.locked}
									class:is-done={ring.done}
									style="--rot:{ring.rot}deg;"
								>
									<!-- today pip (date ring only) — a small dot on the ring's inner
									     shoulder that rides with today's number as you spin. Sits inside
									     the band so it never collides with the marker window. -->
									{#if ring.id === 'date' && todayPip}
										<circle class="today-pip" cx={todayPip.x} cy={todayPip.y} r="2.6">
											<title>Today</title>
										</circle>
									{/if}
									<!-- graduation ticks at each segment boundary -->
									{#each ring.ticks as t, i (t.key)}
										{@const a = (i + 0.5) * seg - 90}
										<path class="grad" d={tickPath(ring.r - 15, ring.r - 11, a)} />
									{/each}
									<!-- value labels -->
									{#each ring.ticks as t, i (t.key)}
										{@const a = i * seg - 90}
										{@const p = polar(ring.r, a)}
										<text
											x={p.x}
											y={p.y}
											transform={upright(p.x, p.y, ring.rot)}
											class="tick {ring.fontClass}"
											class:at-marker={indexAtMarker(ring.rot, n) === i && ring.active}
											class:at-marker-set={indexAtMarker(ring.rot, n) === i && ring.done}
											class:disabled={!t.enabled}>{t.label}</text
										>
									{/each}
								</g>
							</g>
						{/each}

						<!-- Turn-me affordance: two curved arrows hugging the outside of the dial,
						     shown until the guest has actually spun the live ring (whether by hand,
						     by keyboard, or from the panel controls). Paired with the nudge above,
						     they say "grab this and turn it, either way". -->
						{#if showSpinHint}
							{@const hr = R_DATE + 26}
							<g class="spin-hint" aria-hidden="true">
								<path class="hint-arc" d={arcPath(hr, -54, -22)} />
								<path
									class="hint-head"
									transform={headAt(hr, -20, 1)}
									d="M6 0 L-4 4.6 L-4 -4.6 z"
								/>
								<path class="hint-arc" d={arcPath(hr, -126, -158)} />
								<path
									class="hint-head"
									transform={headAt(hr, -160, -1)}
									d="M6 0 L-4 4.6 L-4 -4.6 z"
								/>
							</g>
						{/if}
					</svg>

					<!-- centre readout -->
					<div class="centre" aria-live="polite">
						<span class="c-hint">{centre.hint}</span>
						<span class="c-main">{centre.main}</span>
						{#if step === 2 && timeMode === 'minute'}
							<button type="button" class="c-back" onclick={backToHours}>‹ hours</button>
						{/if}
						{#if step === 2 && (dayFullyBooked || noSlotsAtAll) && !closed}
							<span class="c-sub">See the waitlist →</span>
						{/if}
					</div>
				</div>

				<!-- month pager (only meaningful on the date ring) -->
				<div class="month-pager" class:dim={step > 0}>
					<button
						type="button"
						class="pg"
						onclick={prevMonth}
						disabled={!canPrevMonth}
						aria-label="Previous month">‹</button
					>
					<span class="month-lbl">{monthLabel}</span>
					<button
						type="button"
						class="pg"
						onclick={nextMonth}
						disabled={!canNextMonth}
						aria-label="Next month">›</button
					>
				</div>

				<p class="dial-hint">
					Drag the lit ring round like a rotary dial — whatever stops in the▾ window is your choice.
					Arrow keys work too.
				</p>

				<!-- step rail -->
				<ol class="rail" aria-label="Booking steps">
					<li class:on={step === 0} class:ok={!!date}><span class="r-dot"></span>Date</li>
					<li class:on={step === 1} class:ok={party > 0}><span class="r-dot"></span>Guests</li>
					<li class:on={step === 2} class:ok={!!selectedTime}><span class="r-dot"></span>Time</li>
				</ol>
			{:else if phase === 'done'}
				<div class="terminal">
					<div class="tick-badge" aria-hidden="true">✓</div>
					<h2>{bookingStatus === 'confirmed' ? 'Table confirmed' : 'Table requested'}</h2>
				</div>
			{:else if phase === 'waitlisted'}
				<div class="terminal">
					<div class="tick-badge wait" aria-hidden="true">◷</div>
					<h2>You're on the waitlist</h2>
				</div>
			{:else}
				<div class="terminal">
					<div class="tick-badge pay" aria-hidden="true">£</div>
					<h2>{payment?.kind === 'deposit' ? 'Secure your table' : 'Confirm your card'}</h2>
				</div>
			{/if}
		</div>

		<!-- ===== RIGHT: live summary + details ===== -->
		<aside class="panel">
			{#if phase === 'dial'}
				<h2 class="p-title">Your reservation</h2>
				<p class="p-sub">Spin the dial — or set it here and the dial turns to match.</p>
				<ul class="summary">
					<li class="field">
						<label class="f-k" for="bk-date">Date</label>
						<input
							id="bk-date"
							class="f-c"
							type="date"
							min={today}
							max={maxDate || null}
							value={date}
							onfocus={() => (step = 0)}
							onchange={(e) => setDateFromPanel(e.currentTarget.value)}
						/>
						{#if date}<span class="f-note">{prettyDate}</span>{/if}
					</li>
					<li class="field">
						<label class="f-k" for="bk-guests">Guests</label>
						<select
							id="bk-guests"
							class="f-c"
							value={party ? String(party) : ''}
							onfocus={() => (step = 1)}
							onchange={(e) => setPartyFromPanel(Number(e.currentTarget.value))}
						>
							<option value="" disabled>Choose</option>
							{#each guestTicks as g (g.key)}
								<option value={String(g.value)}
									>{g.label} {Number(g.value) === 1 ? 'guest' : 'guests'}</option
								>
							{/each}
						</select>
					</li>
					<li class="field">
						<label class="f-k" for="bk-time">Time</label>
						<select
							id="bk-time"
							class="f-c"
							disabled={closed || !anyTimeFree}
							value={selectedTime}
							onfocus={() => (step = 2)}
							onchange={(e) => setTimeFromPanel(e.currentTarget.value)}
						>
							<option value="" disabled>{timePlaceholder}</option>
							{#each timeOptions as g (g.hour)}
								<optgroup label="{g.hour}:00">
									{#each g.slots as s (s.time)}
										<option value={s.time} disabled={!s.available}>{hhmm(s.time)}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
					</li>
				</ul>

				{#if bigParty}
					<p class="note">
						For parties over {MAX_ONLINE_PARTY}, please call us on
						<a href="tel:{tel}">{brand.phone}</a> so we can look after you properly.
					</p>
				{:else if closed}
					<p class="note">
						{closureReason || 'We’re closed on this date.'} Please pick another day, or call
						<a href="tel:{tel}">{brand.phone}</a>.
					</p>
				{:else if dayGone}
					<p class="note">
						Every sitting today has already started, so there’s nothing left to book online.
						Pick another date — or call <a href="tel:{tel}">{brand.phone}</a> and we’ll see what we
						can do.
					</p>
				{:else if canWaitlist}
					<form class="details" onsubmit={joinWaitlist}>
						<p class="note">
							This date is fully booked. Join the waitlist and we’ll email you if a table frees up.
						</p>
						<div class="row">
							<label>From<input type="time" bind:value={waitFrom} required /></label>
							<label>Until<input type="time" bind:value={waitTo} min={waitFrom} required /></label>
						</div>
						<div class="row">
							<label
								>First name<input
									type="text"
									bind:value={firstName}
									required
									maxlength="60"
									autocomplete="given-name"
								/></label
							>
							<label
								>Surname<input
									type="text"
									bind:value={lastName}
									required
									maxlength="60"
									autocomplete="family-name"
								/></label
							>
						</div>
						<div class="row">
							<label>Email<input type="email" bind:value={email} required /></label>
							<label>Phone<input type="tel" bind:value={phone} maxlength="40" /></label>
						</div>
						<label class="consent"
							><input type="checkbox" bind:checked={consent} /> Keep me updated with news &amp; offers.</label
						>
						{#if errorMsg}<p class="err">{errorMsg}</p>{/if}
						<button class="cta" type="submit" disabled={submitting}
							>{submitting ? 'Joining…' : 'Join the waitlist'}</button
						>
					</form>
				{:else if summaryReady}
					<form class="details" onsubmit={submit}>
						<div class="row">
							<label
								>First name<input
									type="text"
									bind:value={firstName}
									required
									maxlength="60"
									autocomplete="given-name"
								/></label
							>
							<label
								>Surname<input
									type="text"
									bind:value={lastName}
									required
									maxlength="60"
									autocomplete="family-name"
								/></label
							>
						</div>
						<div class="row">
							<label>Phone<input type="tel" bind:value={phone} maxlength="40" /></label>
							<label>Email<input type="email" bind:value={email} required /></label>
						</div>
						<label
							>Occasion <span class="opt">(optional)</span><input
								type="text"
								bind:value={occasion}
								maxlength="120"
								placeholder="Birthday, anniversary…"
							/></label
						>
						<label
							>Special requests <span class="opt">(optional)</span><textarea
								bind:value={specialRequests}
								rows="2"
								maxlength="2000"
							></textarea></label
						>
						<label class="consent"
							><input type="checkbox" bind:checked={consent} /> Keep me updated with news &amp; offers.</label
						>
						{#if errorMsg}<p class="err">{errorMsg}</p>{/if}
						<button class="cta" type="submit" disabled={submitting}
							>{submitting ? 'Booking…' : 'Reserve →'}</button
						>
					</form>
				{:else}
					<p class="guide-copy">
						{#if step === 0}
							Drag the <strong>outer ring</strong> round to the ▾ marker — or just set the date above
							and the dial will turn itself.
						{:else if step === 1}
							Now spin the <strong>guests ring</strong> to your party size — or pick it above.
						{:else if loadingSlots}
							Finding available tables…
						{:else if timeMode === 'hour'}
							Turn the <strong>inner ring</strong> to an hour, then to the exact time — or choose one
							from the list above.
						{:else}
							Turn to the <strong>minutes</strong> within {selectedHour != null
								? pad(selectedHour)
								: ''}:00 — or choose from the list above.
						{/if}
					</p>
				{/if}

				<div class="policy">
					<h3>Opening hours</h3>
					<ul class="hours">
						{#each liveHours.days as d (d.day)}
							<li>
								<span class="day">{d.day}</span><span class="times"
									>{#if d.periods.length}{#each d.periods as p, i (p.name + p.from)}{i > 0
												? ', '
												: ''}{hhmm(p.from)}–{hhmm(p.to)}{/each}{:else}{d.display}{/if}</span
								>
							</li>
						{/each}
					</ul>
					{#if hoursNote}<p class="fine">{hoursNote}</p>{/if}
					<p class="fine">
						Up to {MAX_ONLINE_PARTY} guests can book online · card required Fri/Sat for 3+ · walk-ins
						welcome. Prefer to talk? Call
						<a href="tel:{tel}">{brand.phone}</a>{#if brand.dishCultUrl}
							· or via <a href={brand.dishCultUrl} target="_blank" rel="noopener noreferrer"
								>Dish Cult</a
							>{/if}.
					</p>
				</div>
			{:else if phase === 'payment'}
				<h2 class="p-title">
					{payment?.kind === 'deposit' ? 'Secure your table' : 'Confirm your card'}
				</h2>
				<p class="recap">
					{prettyDate} · {selectedTime} · {party}
					{party === 1 ? 'guest' : 'guests'}
				</p>
				{#if payment}<p class="guide-copy">{payment.reason}</p>{/if}
				{#if paymentSession?.mode === 'hosted' && paymentSession.hostedUrl}
					<p class="amt">
						{payment?.kind === 'deposit' ? 'Amount due now' : 'We’ll hold (not charge)'}:
						<strong>{moneyGBP(paymentSession.amountPence)}</strong>
					</p>
					<button class="cta" type="button" onclick={payNow}>Continue to secure payment →</button>
					<p class="fine">
						You’ll be taken to our payment provider, then returned here. Already paid? <button
							class="linkish"
							type="button"
							onclick={refreshStatus}
							disabled={polling}>{polling ? 'Checking…' : 'Check status'}</button
						>
					</p>
				{:else}
					<p class="guide-copy">
						Thank you, {name || 'guest'}. Your table is reserved. We’ll confirm shortly{payment?.kind ===
						'deposit'
							? ' once your deposit is settled'
							: ''} and email you the details.
					</p>
					<p class="fine">
						For anything urgent, call <a href="tel:{tel}">{brand.phone}</a>.
						<button class="linkish" type="button" onclick={refreshStatus} disabled={polling}
							>{polling ? 'Checking…' : 'Refresh status'}</button
						>
					</p>
				{/if}
				{#if errorMsg}<p class="err">{errorMsg}</p>{/if}
				<button class="ghost" type="button" onclick={reset}>Make another booking</button>
			{:else if phase === 'waitlisted'}
				<h2 class="p-title">You’re on the waitlist</h2>
				<p class="recap">
					{prettyDate} · {waitFrom}–{waitTo} · {party}
					{party === 1 ? 'guest' : 'guests'}
				</p>
				<p class="guide-copy">
					Thank you, {name || 'guest'}. We’ll email you if a table frees up for this date within
					your chosen window. For anything urgent, call <a href="tel:{tel}">{brand.phone}</a>.
				</p>
				<button class="ghost" type="button" onclick={reset}>Make another booking</button>
			{:else}
				<h2 class="p-title">
					{bookingStatus === 'confirmed' ? 'Table confirmed' : 'Table requested'}
				</h2>
				<p class="recap">
					{prettyDate} · {selectedTime} · {party}
					{party === 1 ? 'guest' : 'guests'}
				</p>
				<p class="guide-copy">
					Thank you, {name || 'guest'}. We’ve received your booking and a confirmation will be sent
					to your email. For anything urgent, call <a href="tel:{tel}">{brand.phone}</a>.
				</p>
				<button class="ghost" type="button" onclick={reset}>Make another booking</button>
			{/if}
		</aside>
	</div>
</section>

<style>
	.dial-book {
		max-width: 1140px;
		margin: 0 auto;
		padding: clamp(2rem, 5vw, 3.5rem) 1.4rem 5rem;
		color: var(--ink);
		font-family: var(--font-serif);
	}
	.head {
		text-align: center;
		margin-bottom: clamp(1.6rem, 4vw, 2.8rem);
	}
	.kicker {
		display: inline-block;
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--accent-2);
		margin-bottom: 0.8rem;
	}
	.head h1 {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(2.4rem, 6vw, 4rem);
		line-height: 1;
		margin: 0 0 0.5rem;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0;
	}

	.layout {
		display: grid;
		grid-template-columns: 1.05fr 0.95fr;
		gap: clamp(1.6rem, 5vw, 4rem);
		align-items: start;
	}

	/* ===== the dial ===== */
	.stage {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.1rem;
	}
	.dial {
		position: relative;
		width: min(80vw, 470px);
		aspect-ratio: 1;
	}
	.rings {
		width: 100%;
		height: 100%;
		overflow: visible;
		touch-action: none; /* let us handle drag without the page panning */
		outline: none;
	}
	.rings:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 6px;
		border-radius: 50%;
	}
	.rings.grabbing {
		cursor: grabbing;
	}

	/* bezel backplates — concentric grooved rings */
	.bezel {
		fill: none;
		stroke: color-mix(in srgb, var(--ink) 10%, transparent);
		stroke-width: 30;
		transition:
			stroke 0.4s var(--ease-editorial),
			opacity 0.4s var(--ease-editorial);
	}
	.bezel.is-active {
		/* Saffron is luminous, so a lighter wash than the old terracotta needed. */
		stroke: color-mix(in srgb, var(--accent) 10%, transparent);
	}
	.bezel.is-done {
		stroke: color-mix(in srgb, var(--accent) 6%, transparent);
	}
	.bezel.is-locked {
		opacity: 0.4;
	}

	/* top marker — small chevron above the outer bezel */
	.marker {
		fill: var(--accent);
	}

	/* the lit slot the chosen value sits in */
	.win {
		fill: none;
		stroke: color-mix(in srgb, var(--accent) 24%, transparent);
		stroke-width: 30;
		/* butt, not round: round caps add half the 30px stroke at each end, which
		   ballooned a one-day slot into a three-day smear. */
		stroke-linecap: butt;
		transition: stroke 0.4s var(--ease-editorial);
	}
	.win.is-done {
		stroke: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	/* one-off "this thing turns" flick on the live ring, until it's been spun */
	.ring-wrap {
		transform-box: view-box;
		transform-origin: 160px 160px;
	}
	.ring-wrap.nudge {
		animation: dial-nudge 3.6s var(--ease-editorial) 1s infinite;
	}
	@keyframes dial-nudge {
		0%,
		60%,
		100% {
			transform: rotate(0deg);
		}
		68% {
			transform: rotate(5deg);
		}
		78% {
			transform: rotate(-3.4deg);
		}
		88% {
			transform: rotate(1.4deg);
		}
	}

	/* curved turn-me arrows hugging the outside of the dial */
	.spin-hint {
		pointer-events: none;
		animation: hint-breathe 2.6s ease-in-out infinite;
	}
	.hint-arc {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.6;
		stroke-linecap: round;
		opacity: 0.85;
	}
	.hint-head {
		fill: var(--accent);
		opacity: 0.85;
	}
	@keyframes hint-breathe {
		0%,
		100% {
			opacity: 0.45;
		}
		50% {
			opacity: 1;
		}
	}

	.ring {
		transform-box: view-box;
		transform-origin: 160px 160px;
		transform: rotate(var(--rot, 0deg));
	}
	/* no CSS transition while dragging (we drive rotation live); ease the snap-back
	   only when NOT dragging via a class on the svg */
	.rings:not(.grabbing) .ring {
		transition: transform 0.45s var(--ease-editorial);
	}
	.ring.is-locked {
		opacity: 0.28;
		pointer-events: none;
	}
	/* A set ring stays dimmer than the focused one but is NOT disabled — you can
	   grab it again to change your choice. */
	.ring.is-done {
		opacity: 0.7;
		cursor: grab;
	}

	.grad {
		stroke: color-mix(in srgb, var(--ink) 30%, transparent);
		stroke-width: 1;
		fill: none;
	}
	.ring.is-active .grad {
		stroke: color-mix(in srgb, var(--accent) 55%, transparent);
	}
	/* small pip marking TODAY on the date ring's inner shoulder */
	.today-pip {
		fill: var(--accent-2);
		opacity: 0.9;
	}

	.tick {
		font-family: var(--font-sans);
		font-size: 9px;
		font-weight: 500;
		fill: var(--ink-soft);
		text-anchor: middle;
		dominant-baseline: middle;
		letter-spacing: 0.02em;
		transition:
			fill 0.2s var(--ease-editorial),
			font-size 0.2s var(--ease-editorial);
		user-select: none;
	}
	.tick-xs {
		font-size: 8px;
	}
	.tick.disabled {
		fill: var(--ink-faint);
		opacity: 0.35;
		text-decoration: line-through;
	}
	/* the value sitting under the ▾ marker on the active ring — big & terracotta */
	.tick.at-marker {
		fill: var(--accent);
		font-weight: 700;
		font-size: 13px;
	}
	/* the committed value on a set (but still changeable) ring — accent, but calmer
	   than the active ring so focus stays on the current step */
	.tick.at-marker-set {
		fill: var(--accent);
		font-weight: 700;
	}
	.ring.is-active {
		cursor: grab;
	}

	/* centre readout */
	.centre {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.25rem;
		padding: 0 26%;
		pointer-events: none;
	}
	.centre > * {
		pointer-events: auto;
	}
	.c-hint {
		font-family: var(--font-sans);
		font-size: 0.58rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent-2);
	}
	.c-main {
		font-family: var(--font-display);
		font-size: clamp(1.2rem, 2.6vw, 1.7rem);
		line-height: 1.05;
		color: var(--ink);
	}
	.c-back {
		margin-top: 0.15rem;
		background: none;
		border: 0;
		font-family: var(--font-sans);
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent-2);
		cursor: pointer;
	}
	.c-back:hover {
		color: var(--accent);
	}
	.c-sub {
		font-family: var(--font-sans);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		color: var(--accent);
		margin-top: 0.15rem;
	}

	.dial-hint {
		font-family: var(--font-sans);
		font-size: 0.68rem;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
		margin: 0;
		text-align: center;
	}

	/* month pager */
	.month-pager {
		display: flex;
		align-items: center;
		gap: 1.1rem;
		transition: opacity 0.4s var(--ease-editorial);
	}
	.month-pager.dim {
		opacity: 0.45;
	}
	.month-lbl {
		font-family: var(--font-sans);
		font-size: 0.78rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink);
		min-width: 9.5rem;
		text-align: center;
	}
	.pg {
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		border: 1px solid var(--frame-line);
		background: transparent;
		color: var(--accent);
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.pg:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--bg);
	}
	.pg:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* step rail */
	.rail {
		display: flex;
		gap: 1.4rem;
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
	}
	.rail li {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-family: var(--font-sans);
		font-size: 0.66rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-faint);
		transition: color 0.3s var(--ease-editorial);
	}
	.rail li.on {
		color: var(--accent);
	}
	.rail li.ok {
		color: var(--ink);
	}
	.r-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1px solid currentColor;
		background: transparent;
	}
	.rail li.ok .r-dot,
	.rail li.on .r-dot {
		background: var(--accent);
		border-color: var(--accent);
	}

	/* ===== right panel ===== */
	.panel {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: clamp(1.5rem, 3vw, 2.2rem);
	}
	.p-title {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: 1.6rem;
		margin: 0 0 1.2rem;
		color: var(--ink);
	}
	.summary {
		list-style: none;
		margin: 0 0 1.4rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	/* ── editable summary fields ──────────────────────────────────────────────
	   Ordinary form controls for anyone who doesn't fancy spinning bezels. Each
	   one turns its ring (see setDateFromPanel/setPartyFromPanel/setTimeFromPanel),
	   so the dial stays the single source of truth on screen. */
	.field {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.6rem 1rem;
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: color-mix(in srgb, var(--bg) 45%, transparent);
		transition: border-color 0.2s ease;
	}
	.field:focus-within {
		border-color: var(--accent);
	}
	.f-k {
		font-family: var(--font-sans);
		font-size: 0.64rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent-2);
	}
	.f-c {
		width: 100%;
		min-width: 0;
		justify-self: end;
		text-align: right;
		font-family: var(--font-display);
		font-size: 1.02rem;
		color: var(--ink);
		background: transparent;
		border: 0;
		border-bottom: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
		padding: 0.15rem 0 0.2rem;
		cursor: pointer;
	}
	.f-c:focus {
		outline: none;
		border-bottom-style: solid;
		border-bottom-color: var(--accent);
	}
	.f-c:disabled {
		opacity: 0.55;
		cursor: default;
		border-bottom-style: dotted;
	}
	/* Native select needs its own caret to sit on the dark ground. */
	select.f-c {
		appearance: none;
		padding-right: 1.1rem;
		/* The POPUP is drawn by the OS from the control's own colours. With
		   `background: transparent` inherited from .f-c, Chrome painted the guests /
		   time lists as near-white ink on a near-white sheet — unreadable. The option
		   rules below give the list a real ground; color-scheme tells the platform to
		   render its chrome (scrollbar, highlight, the date field's calendar button)
		   dark to match. */
		color-scheme: dark;
		background-image:
			linear-gradient(45deg, transparent 50%, var(--accent) 50%),
			linear-gradient(135deg, var(--accent) 50%, transparent 50%);
		background-position:
			right 0.42rem center,
			right 0.15rem center;
		background-size:
			0.28rem 0.28rem,
			0.28rem 0.28rem;
		background-repeat: no-repeat;
	}
	/* Opaque, high-contrast option list. --card/--bg are translucent (they sit over
	   the page), which a native popup can't composite against anything — so the
	   popup gets the solid --bg-2 instead. */
	select.f-c option,
	select.f-c optgroup {
		background-color: var(--bg-2);
		color: var(--ink);
		font-family: var(--font-sans);
	}
	select.f-c optgroup {
		color: var(--accent);
		font-style: normal;
	}
	select.f-c option:disabled {
		color: color-mix(in srgb, var(--ink) 42%, transparent);
	}
	/* The date field's native picker + calendar button need the same treatment. */
	input.f-c[type='date'] {
		color-scheme: dark;
	}
	/* The pretty long-form date under the date input. */
	.f-note {
		grid-column: 2;
		justify-self: end;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 0.86rem;
		color: var(--ink-faint);
	}
	.p-sub {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.06em;
		color: var(--ink-faint);
		margin: -0.7rem 0 1.1rem;
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		margin-bottom: 1.6rem;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.8rem;
	}
	.details label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-family: var(--font-sans);
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.opt {
		text-transform: none;
		letter-spacing: 0;
		color: var(--ink-faint);
		font-style: italic;
	}
	.details input,
	.details textarea {
		font-family: var(--font-serif);
		font-size: 1rem;
		padding: 0.65rem 0.75rem;
		border-radius: 5px;
		border: 1px solid var(--line);
		background: color-mix(in srgb, var(--bg) 50%, transparent);
		color: var(--ink);
	}
	.details input:focus,
	.details textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.consent {
		flex-direction: row !important;
		align-items: center;
		gap: 0.5rem;
		text-transform: none !important;
		letter-spacing: 0 !important;
		font-family: var(--font-serif) !important;
		font-size: 0.92rem !important;
		color: var(--ink-soft);
	}
	.consent input {
		width: auto;
	}

	.cta {
		font-family: var(--font-sans);
		font-size: 0.78rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		padding: 1rem 1.4rem;
		border-radius: 5px;
		border: 0;
		background: var(--accent);
		color: var(--bg);
		font-weight: 500;
		cursor: pointer;
		transition: background 0.3s var(--ease-editorial);
	}
	.cta:hover:not(:disabled) {
		background: var(--ink);
	}
	.cta:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ghost {
		align-self: flex-start;
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
		padding: 0.65rem 1.2rem;
		border-radius: 5px;
		cursor: pointer;
		font-family: var(--font-serif);
		font-style: italic;
		margin-top: 1rem;
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

	.guide-copy,
	.note,
	.recap,
	.amt {
		font-size: 1rem;
		line-height: 1.6;
		color: var(--ink-soft);
		margin: 0 0 1.2rem;
	}
	.guide-copy strong {
		color: var(--ink);
	}
	.recap {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.amt strong {
		color: var(--ink);
	}
	.note a,
	.fine a,
	.guide-copy a {
		color: var(--accent);
	}
	.err {
		color: #c0342b;
		font-style: italic;
		font-size: 0.95rem;
		margin: 0;
	}

	.policy {
		border-top: 1px solid var(--line);
		padding-top: 1.4rem;
	}
	.policy h3 {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: 1.15rem;
		margin: 0 0 0.8rem;
		color: var(--accent);
	}
	.hours {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
	}
	.hours li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-family: var(--font-sans);
		font-size: 0.8rem;
		padding: 0.25rem 0;
		color: var(--ink-soft);
	}
	.hours .day {
		color: var(--ink);
	}
	.fine {
		font-size: 0.88rem;
		line-height: 1.55;
		color: var(--ink-faint);
		margin: 0;
	}

	/* terminal states on the left */
	.terminal {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.2rem;
		min-height: min(80vw, 470px);
		text-align: center;
	}
	.tick-badge {
		width: 5rem;
		height: 5rem;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font-size: 2rem;
		color: var(--bg);
		background: var(--accent);
		box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.tick-badge.wait,
	.tick-badge.pay {
		background: var(--accent-2);
		box-shadow: 0 0 0 10px color-mix(in srgb, var(--accent-2) 18%, transparent);
	}
	.terminal h2 {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(1.6rem, 4vw, 2.4rem);
		margin: 0;
		color: var(--ink);
	}

	@media (max-width: 860px) {
		/* minmax(0, …), not a bare 1fr: a track's floor is its content, and the
		   details form's two-up inputs would hold the panel wider than a phone. */
		.layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 2rem;
		}
		/* max-width: 90vw is measured from the screen, but the dial sits inside the
		   page's 1.4rem gutters — at 360px that's a 324px dial in a 315px column. */
		.dial {
			width: min(90vw, 430px);
			max-width: 100%;
		}
	}

	/* Phone. Written from the source, not from a screen — the dial is parked
	   behind the ResDiary widget (see $lib/bookings/engine.ts) and can't be reached
	   on a production build. */
	@media (max-width: 480px) {
		/* The two-up rows (names, phone/email, waitlist times): a text input's
		   intrinsic width is ~20 characters, so two of them could not share a
		   ~265px panel and pushed out of it. */
		.details label {
			min-width: 0;
		}
		.details input,
		.details textarea {
			box-sizing: border-box;
			width: 100%;
			min-width: 0;
		}
		/* Same specificity as the rule above and now later in the file, so the
		   consent checkbox needs its exemption restated. */
		.details .consent input {
			width: auto;
		}
		/* Tracked caps under ~11px. */
		.f-k,
		.details label,
		.rail li {
			font-size: 0.72rem;
		}
		.p-sub,
		.dial-hint {
			font-size: 0.78rem;
		}
		/* Month pager arrows: 35px → 44px. */
		.pg {
			width: 2.75rem;
			height: 2.75rem;
		}
		.month-pager {
			gap: 0.6rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rings:not(.grabbing) .ring {
			transition: none;
		}
		/* Keep the affordance, drop the movement: the arrows stay, they just don't
		   breathe, and the ring doesn't flick. */
		.ring-wrap.nudge,
		.spin-hint {
			animation: none;
		}
	}
</style>
