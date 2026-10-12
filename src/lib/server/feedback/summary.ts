// Guest scores report — the per-day 0–5 breakdown (ResDiary "Feedback Summary").
//
// Deliberately NOT sentiment.ts's summariseFeedbackByDay: that one is for imported
// public reviews, where a rating of 0 means "no rating" and is dropped from the
// star columns. Here 0 is the worst score a guest can give, so it has its own
// column and pulls the average down like any other answer.

export type ScoreCounts = [number, number, number, number, number, number];

export interface ScoreDayRow {
	/** London visit day 'YYYY-MM-DD' ('' on the Totals row). */
	date: string;
	/** score -> number of replies (index 0..5). */
	counts: ScoreCounts;
	/** score -> % of that row's replies (0..100, one decimal). */
	pct: ScoreCounts;
	/** Mean score, two decimals; 0 when there are no replies. */
	average: number;
	total: number;
}

export interface ScoreSummary {
	/** Newest visit day first, matching the imported-reviews summary. */
	byDay: ScoreDayRow[];
	totals: ScoreDayRow;
}

function localDay(iso: string, timezone: string): string {
	const t = Date.parse((iso || '').replace(' ', 'T'));
	if (!Number.isFinite(t)) return '';
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(t));
}

export function summariseScoresByDay(
	rows: Array<{ score: number; visit_at: string }>,
	timezone = 'Europe/London'
): ScoreSummary {
	const blank = (date: string) => ({
		row: {
			date,
			counts: [0, 0, 0, 0, 0, 0] as ScoreCounts,
			pct: [0, 0, 0, 0, 0, 0] as ScoreCounts,
			average: 0,
			total: 0
		},
		sum: 0
	});

	const days = new Map<string, ReturnType<typeof blank>>();
	const totals = blank('');

	for (const r of rows) {
		const date = localDay(r.visit_at, timezone);
		if (!date || !Number.isInteger(r.score) || r.score < 0 || r.score > 5) continue;
		const day = days.get(date) ?? blank(date);
		for (const t of [day, totals]) {
			t.row.counts[r.score]++;
			t.row.total++;
			t.sum += r.score;
		}
		days.set(date, day);
	}

	const finalise = (t: ReturnType<typeof blank>): ScoreDayRow => {
		const n = t.row.total;
		for (let s = 0; s <= 5; s++) {
			t.row.pct[s] = n > 0 ? Math.round((t.row.counts[s] / n) * 1000) / 10 : 0;
		}
		t.row.average = n > 0 ? Math.round((t.sum / n) * 100) / 100 : 0;
		return t.row;
	};

	return {
		byDay: [...days.values()].map(finalise).sort((a, b) => b.date.localeCompare(a.date)),
		totals: finalise(totals)
	};
}
