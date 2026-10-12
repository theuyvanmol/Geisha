// THE DIARY'S WALK-IN FIGURE, in the same unit as everything beside it.
//
// The meta strip reads "Daytime 18 Pax · Dinner 54 Pax · Walk-ins …". It used to end
// "Walk-ins 19 · 40 Pax": 19 was walk-in PARTIES for the whole DAY, sitting right after
// figures that are COVERS for one SERVICE — so the client read it as 19 walk-ins out of
// 18 covers (Asia, 1 Oct 2026) and reported the count as wrong. The arithmetic was fine;
// the units weren't. So the strip now gives walk-in covers per service, and the party
// count lives only in the hover text, where it says it's parties.

export interface WalkinTotals {
	walkins: number;
	walkinCovers: number;
	covers: number;
}

export function walkinFigure(
	periods: { periodId: string; name: string }[],
	coversByPeriod: Map<string, number>,
	t: WalkinTotals
): { text: string; title: string } {
	const text =
		periods.length > 1
			? `${periods.map((p) => `${p.name} ${coversByPeriod.get(p.periodId) ?? 0}`).join(' · ')} Pax`
			: `${t.walkinCovers} Pax`;
	const parties = `${t.walkins} walk-in ${t.walkins === 1 ? 'party' : 'parties'}`;
	const title = `${parties} today — ${t.walkinCovers} of ${t.covers} covers. Already counted in the Pax above.`;
	return { text, title };
}
