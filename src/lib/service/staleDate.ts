/**
 * Should a service board (Diary / Floor Plan) that has just OPENED on `date` jump
 * forward to `today`?
 *
 * A service terminal is opened once and left up, so the date in its URL goes stale
 * overnight — and nothing on screen contradicts itself, so staff have no reason to
 * doubt it. Owner: "it defaults to yesterday… consistently having to change the day".
 *
 * Two ways to ARRIVE on a stale date count:
 *   · 'enter' — the initial document load (a restored tab, a refresh).
 *   · the hand-back from the sign-in page. The staff session lasts 12h, so by the next
 *     service it has always run out; the hook bounces the terminal to
 *     /admin/login?redirectTo=<the URL it was on>, and the sign-in form (use:enhance)
 *     returns to that URL with a client-side goto — last night's ?date= and all. This
 *     was the everyday route, and the 'enter'-only check never saw it.
 * Every other arrival ('link' / 'goto' / 'popstate' from inside the app — the "back to
 * diary" link on a past booking, the Close-Outs calendar, the back button) is a
 * deliberate look at that date and is left alone.
 *
 * `pick` is this tab's own stamp of the date it chose and the day it chose it on: a
 * refresh (or a re-sign-in) while reviewing last Saturday stays on last Saturday. Only
 * a stamp from an earlier day — or none — reads as stale.
 */
export function shouldSnapToToday(o: {
	type: string;
	fromPath: string | null;
	date: string;
	today: string;
	pick: { date?: string; today?: string } | null;
}): boolean {
	const arrived = o.type === 'enter' || o.fromPath === '/admin/login';
	if (!arrived || o.date >= o.today) return false; // ISO dates compare as strings
	return !(o.pick?.date === o.date && o.pick?.today === o.today);
}
