import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BriefingSnapshot } from './briefing.js';
import type { SeatingPlan } from '../booking/optimise.js';
import type { BookingRisk } from './risk/noShowRisk.js';

// --- mock the deterministic data sources + the LLM ---------------------------
// assembleEveningPlan pulls facts from three pure-ish engines (each hits PB) and
// frames them with runAgent. We stub all four so the test exercises ONLY the
// copilot's assembly/checklist logic, deterministically and offline.

const buildSnapshot = vi.fn();
const getSeatingPlan = vi.fn();
const computeDayRisk = vi.fn();
const runAgent = vi.fn();

vi.mock('./briefing.js', () => ({ buildSnapshot: (...a: unknown[]) => buildSnapshot(...a) }));
vi.mock('../booking/optimise.js', () => ({
	getSeatingPlan: (...a: unknown[]) => getSeatingPlan(...a)
}));
vi.mock('./risk/noShowRisk.js', () => ({
	computeDayRisk: (...a: unknown[]) => computeDayRisk(...a)
}));
vi.mock('./geminiAgent.js', () => ({ runAgent: (...a: unknown[]) => runAgent(...a) }));

const { assembleEveningPlan, fallbackNarration } = await import('./copilot.js');

// --- fixtures ----------------------------------------------------------------

function snapshot(over: Partial<BriefingSnapshot> = {}): BriefingSnapshot {
	return {
		brand: 'asia',
		date: '2026-06-27',
		restaurantName: 'Geisha Asia',
		dashboard: { totalBookings: 12, totalCovers: 40, seated: 0, pendingPayment: 1 },
		firstArrival: '18:00',
		lastArrival: '21:30',
		risk: { high: 1, medium: 2, low: 9, top: [] },
		allergies: { flaggedBookings: 2, allergyAlerts: 1, rows: [
			{ time: '19:00', guest: 'Khan', partySize: 4, allergies: ['Nuts'], dietary: [] }
		] },
		vips: [{ time: '20:00', name: 'Patel', partySize: 2, tags: ['vip'] }],
		pacing: {
			coldStart: false,
			periods: [{ periodName: 'Dinner', expectedCovers: 38, recommendedPeriodCap: 50, coldStart: false }]
		},
		reviews: {
			windowDays: 14,
			count: 5,
			averageRating: 4.4,
			topThemes: [],
			sentiment: { positive: 3, neutral: 1, negative: 1 },
			needsAttention: 1
		},
		...over
	};
}

function emptySeating(): SeatingPlan {
	return {
		date: '2026-06-27',
		moves: [],
		considered: 0,
		pinned: 0,
		unseated: [],
		summary: {
			wastedSeatsBefore: 0,
			wastedSeatsAfter: 0,
			joinsBefore: 0,
			joinsAfter: 0,
			movesCount: 0
		}
	};
}

function seatingWithMove(): SeatingPlan {
	return {
		date: '2026-06-27',
		considered: 1,
		pinned: 0,
		unseated: [],
		moves: [
			{
				bookingId: 'bk1',
				partySize: 4,
				startsAt: '2026-06-27T18:00:00.000Z',
				fromTableIds: ['t2'],
				toTableIds: ['t7'],
				fromLabel: 'T2',
				toLabel: 'T7',
				wastedBefore: 4,
				wastedAfter: 0,
				createsJoin: false,
				removesJoin: false
			}
		],
		summary: {
			wastedSeatsBefore: 4,
			wastedSeatsAfter: 0,
			joinsBefore: 0,
			joinsAfter: 0,
			movesCount: 1
		}
	};
}

function risk(over: Partial<BookingRisk> & { bookingId: string }): BookingRisk {
	return {
		customerName: 'Guest',
		customerId: 'cust1',
		partySize: 2,
		startsAt: '2026-06-27T19:00:00.000Z',
		status: 'confirmed',
		source: 'online',
		hasDeposit: false,
		risk: { score: 72, band: 'high', factors: [{ label: 'prior no-show', weight: 0.3 }] },
		...over
	} as BookingRisk;
}

beforeEach(() => {
	buildSnapshot.mockReset();
	getSeatingPlan.mockReset();
	computeDayRisk.mockReset();
	runAgent.mockReset();
	// Default: LLM unconfigured → forces the deterministic narration fallback.
	runAgent.mockResolvedValue({ configured: false, answer: '', directives: [], toolsUsed: [] });
});

describe('assembleEveningPlan', () => {
	it('rejects a non-ISO date', async () => {
		await expect(assembleEveningPlan('asia', 'tonight')).rejects.toThrow(/YYYY-MM-DD/);
	});

	it('maps each seating move to a confirm-gated move_booking action', async () => {
		buildSnapshot.mockResolvedValue(snapshot());
		getSeatingPlan.mockResolvedValue(seatingWithMove());
		computeDayRisk.mockResolvedValue([]);

		const plan = await assembleEveningPlan('asia', '2026-06-27');
		const seat = plan.items.find((i) => i.kind === 'seating');
		expect(seat).toBeTruthy();
		expect(seat!.actionKind).toBe('write');
		expect(seat!.action).toEqual({
			tool: 'move_booking',
			input: { bookingId: 'bk1', tableIds: ['t7'] }
		});
		expect(plan.stats.seatingMoves).toBe(1);
		expect(plan.stats.seatsFreed).toBe(4);
	});

	it('chases only un-deposited medium/high risks via draft_message (a READ)', async () => {
		buildSnapshot.mockResolvedValue(snapshot());
		getSeatingPlan.mockResolvedValue(emptySeating());
		computeDayRisk.mockResolvedValue([
			risk({ bookingId: 'bk1', customerId: 'c1', hasDeposit: false }), // chased
			risk({ bookingId: 'bk2', customerId: 'c2', hasDeposit: true }), // skipped (deposit)
			risk({
				bookingId: 'bk3',
				customerId: 'c3',
				hasDeposit: false,
				risk: { score: 5, band: 'low', factors: [] }
			}) // skipped (low)
		]);

		const plan = await assembleEveningPlan('asia', '2026-06-27');
		const chases = plan.items.filter((i) => i.kind === 'risk');
		expect(chases).toHaveLength(1);
		expect(chases[0].actionKind).toBe('read');
		expect(chases[0].action).toEqual({
			tool: 'draft_message',
			input: { customerId: 'c1', kind: 'reminder' }
		});
	});

	it('emits a risk NOTE (no action) when the customer id is missing', async () => {
		buildSnapshot.mockResolvedValue(snapshot());
		getSeatingPlan.mockResolvedValue(emptySeating());
		computeDayRisk.mockResolvedValue([
			risk({ bookingId: 'bk1', customerId: '', hasDeposit: false })
		]);

		const plan = await assembleEveningPlan('asia', '2026-06-27');
		const chase = plan.items.find((i) => i.kind === 'risk');
		expect(chase).toBeTruthy();
		expect(chase!.action).toBeUndefined(); // can't draft without a customer id
		expect(chase!.link).toContain('/admin/bookings/bk1');
	});

	it('adds run-sheet NOTE items for allergies, VIPs, pacing and reviews', async () => {
		buildSnapshot.mockResolvedValue(snapshot());
		getSeatingPlan.mockResolvedValue(emptySeating());
		computeDayRisk.mockResolvedValue([]);

		const plan = await assembleEveningPlan('asia', '2026-06-27');
		const noteTitles = plan.items.filter((i) => i.kind === 'note').map((i) => i.id);
		expect(noteTitles).toContain('allergy');
		expect(noteTitles).toContain('vips');
		expect(noteTitles).toContain('pacing');
		expect(noteTitles).toContain('reviews');
		// Notes are informational — never carry a firable action.
		for (const n of plan.items.filter((i) => i.kind === 'note')) {
			expect(n.action).toBeUndefined();
		}
	});

	it('degrades gracefully when the seating + risk engines throw', async () => {
		buildSnapshot.mockResolvedValue(snapshot({ allergies: { flaggedBookings: 0, allergyAlerts: 0, rows: [] }, vips: [], reviews: { windowDays: 14, count: 0, averageRating: null, topThemes: [], sentiment: { positive: 0, neutral: 0, negative: 0 }, needsAttention: 0 } }));
		getSeatingPlan.mockRejectedValue(new Error('pb down'));
		computeDayRisk.mockRejectedValue(new Error('pb down'));

		const plan = await assembleEveningPlan('asia', '2026-06-27');
		expect(plan.stats.seatingMoves).toBe(0);
		expect(plan.items.filter((i) => i.kind === 'seating')).toHaveLength(0);
		expect(plan.items.filter((i) => i.kind === 'risk')).toHaveLength(0);
		// still produces a headline + narration from the snapshot
		expect(plan.headline).toContain('cover');
		expect(plan.narration.length).toBeGreaterThan(0);
	});

	it('uses the LLM narration when configured, else the deterministic fallback', async () => {
		buildSnapshot.mockResolvedValue(snapshot());
		getSeatingPlan.mockResolvedValue(emptySeating());
		computeDayRisk.mockResolvedValue([]);

		// configured + non-errored → aiWritten true
		runAgent.mockResolvedValue({
			configured: true,
			errored: false,
			answer: 'Busy night — start with the checklist.',
			directives: [],
			toolsUsed: []
		});
		const aiPlan = await assembleEveningPlan('asia', '2026-06-27');
		expect(aiPlan.aiWritten).toBe(true);
		expect(aiPlan.narration).toBe('Busy night — start with the checklist.');

		// errored → fallback
		runAgent.mockResolvedValue({
			configured: true,
			errored: true,
			answer: 'rate limited',
			directives: [],
			toolsUsed: []
		});
		const fbPlan = await assembleEveningPlan('asia', '2026-06-27');
		expect(fbPlan.aiWritten).toBe(false);
		expect(fbPlan.narration).toContain('Tonight');
	});
});

describe('fallbackNarration', () => {
	it('is honest about every lane and ends with the checklist nudge', () => {
		const text = fallbackNarration('12 bookings, 40 covers.', {
			totalBookings: 12,
			totalCovers: 40,
			seatingMoves: 2,
			seatsFreed: 6,
			highRisk: 1,
			mediumRisk: 2,
			allergyAlerts: 1,
			vips: 1,
			openAlerts: 0
		});
		expect(text).toContain('40 covers');
		expect(text).toContain('2 seating moves');
		expect(text).toContain('free 6 seats');
		expect(text).toMatch(/no-show risk/);
		expect(text).toContain('allergy alert');
		expect(text).toContain('VIP');
		expect(text).toMatch(/checklist below/);
	});
});
