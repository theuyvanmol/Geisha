// Print a clean booking slip (Floor ↔ Diary parity).
//
// Opens a self-contained printable card in a new window and calls print(). No server
// round-trip — everything is already in the normalized BookingView. Lifted verbatim
// from the diary's `printBooking` so both service views print an identical slip.
//
// Returns false if the pop-up was blocked, so the caller can surface "allow pop-ups".

import type { BookingView } from './bookingView';
// PocketBase datetimes use a space, not a 'T' — only V8 parses that. See datetime.ts.
import { parseBookingDate } from '$lib/bookings/datetime';

const fmt = (iso: string) =>
	parseBookingDate(iso)?.toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/London'
	}) ?? '—';

const esc = (s: unknown) =>
	String(s ?? '').replace(/[&<>"]/g, (ch) =>
		ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
	);

const row = (label: string, value?: string) =>
	value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '';

/** Open + print a booking slip for `b` on `brand`/`date`. Returns false if blocked. */
export function printBookingSlip(b: BookingView, brand: string, date: string): boolean {
	const html = `<!doctype html><html><head><meta charset="utf-8"><title>Booking ${esc(b.ref)}</title>
		<style>
			body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;margin:32px;}
			h1{font-size:20px;margin:0 0 2px;}
			.sub{color:#666;margin:0 0 18px;font-size:13px;}
			table{border-collapse:collapse;width:100%;max-width:520px;}
			th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top;}
			th{width:160px;color:#555;font-weight:600;}
			.notes{margin-top:16px;max-width:520px;}
			.notes h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#888;margin:14px 0 4px;}
			.notes p{margin:0 0 6px;white-space:pre-wrap;}
			@media print{body{margin:0;padding:18mm;}}
		</style></head><body>
		<h1>${esc(b.guestName)} · ${b.partySize} cover${b.partySize === 1 ? '' : 's'}</h1>
		<p class="sub">${esc(brand.toUpperCase())} · Ref ${esc(b.ref)} · ${esc(date)}</p>
		<table>
			${row('Arrival', fmt(b.startsAt))}
			${row('Leave', fmt(b.endsAt) + (b.leaveTimeConfirmed ? ' (confirmed)' : ''))}
			${row('Table(s)', b.tableLabels.join(', ') || '—')}
			${row('Phone', b.phone)}
			${row('Email', b.email)}
			${row('Channel', b.channel)}
			${row('Promotion', b.promotion)}
			${row('Menu', b.menu)}
			${row('Occasion', b.occasion)}
			${row('Visit', b.firstVisit ? '1st visit' : 'Returning')}
		</table>
		${
			b.allergies || b.bookingComments || b.noteToRestaurant || b.customerComments
				? `<div class="notes">
					${b.allergies ? `<h2>Allergies</h2><p>${esc(b.allergies)}</p>` : ''}
					${b.bookingComments ? `<h2>Booking comments</h2><p>${esc(b.bookingComments)}</p>` : ''}
					${b.noteToRestaurant ? `<h2>Note to restaurant</h2><p>${esc(b.noteToRestaurant)}</p>` : ''}
					${b.customerComments ? `<h2>Customer history</h2><p>${esc(b.customerComments)}</p>` : ''}
				</div>`
				: ''
		}
		<script>window.onload=function(){window.print();}<\/script>
		</body></html>`;
	const w = window.open('', '_blank', 'width=620,height=760');
	if (!w) return false;
	w.document.write(html);
	w.document.close();
	return true;
}
