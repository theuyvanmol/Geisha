// Guided-tour scripts for the admin back-office onboarding system.
//
// A TOUR is a scripted, multi-step walkthrough of ONE real task in this app. Each
// step narrates what to do; if it carries a `path` the tour navigates there on
// entry, and if it carries a `selector` the TourRunner spotlights that element on
// the page. Steps with neither degrade gracefully to a narrated card (title + body).
//
// ⚠️ CLIENT-SAFE. Pure data, imports only the StaffRole type — safe in either
// bundle. The runtime store (training.svelte.ts) and the UI (TourRunner.svelte)
// consume this; the assistant's `start_tour` UI tool references the ids by name.
//
// SELECTORS are grounded in the real routes as they stand today (verified against
// the diary/closures/deposits pages). Where a control is created dynamically or is
// awkward to target reliably, the step is deliberately selector-less so it reads as
// a narrated instruction rather than spotlighting the wrong thing. Keep selectors
// resilient: prefer a stable class already in the markup over a brittle deep path.

import type { StaffRole } from '$lib/server/db/types';

/** One step of a guided tour. */
export type TourStep = {
	/** Short heading for the step card. */
	title: string;
	/** The instruction — one or two sentences, plain language. */
	body: string;
	/** If set, the tour navigates to this admin route when the step is entered.
	 *  Carry the ?brand query at runtime — these are the bare paths. */
	path?: string;
	/** If set, the runner tries to spotlight this element (CSS selector). Optional —
	 *  a step with no selector is just a narrated card. */
	selector?: string;
	/** Advisory hint that the step expects the user to click the spotlighted thing
	 *  themselves (the runner still shows Next; this only tunes the copy/affordance). */
	waitForClick?: boolean;
};

/** A complete guided tour. */
export type Tour = {
	/** Stable id — referenced by the assistant's start_tour tool and localStorage. */
	id: string;
	/** Title shown in the checklist and the runner header. */
	title: string;
	/** One line describing what the tour teaches. */
	description: string;
	/** Minimum role required to take the tour (matches the page's real gating). */
	role: StaffRole;
	steps: TourStep[];
};

// Six tours covering the day-to-day jobs a new host/manager must learn. Ordered
// from the most common front-of-house task to back-office configuration.
export const TOURS: Tour[] = [
	// 1) Take a phone booking — the single most common host task.
	{
		id: 'phone-booking',
		title: 'Take a phone booking',
		description: 'Add a booking to the diary while a guest is on the phone.',
		role: 'host',
		steps: [
			{
				title: 'Open the Diary',
				body: 'The Diary is the service timeline you run the shift from — tables down the side, bookings as bars across time. Everything about the book for a day lives here.',
				path: '/admin/diary'
			},
			{
				title: 'Start a new booking',
				body: 'Click "Book" in the toolbar to open the new-booking form. (For a guest who is here right now rather than booking ahead, use "Walk-in" instead.)',
				selector: '.act-book',
				waitForClick: true
			},
			{
				title: 'Enter the party and time',
				body: 'Put in the party size and the date/time the guest wants. The form shows which times are bookable and picks a suitable table for you — you can override the table if you need a specific one.'
			},
			{
				title: 'Take the guest\'s details',
				body: 'Add the name and phone number. If a deposit or card is required for that party size or day, the form tells you — collect it per policy before you confirm.'
			},
			{
				title: 'Confirm the booking',
				body: 'Submit the form. The booking appears as a bar on the diary at that table and time. If you took it by phone you can mark it Confirmed from the booking\'s card.'
			}
		]
	},

	// 2) Handle a walk-in — live seating on the floor.
	{
		id: 'walk-in',
		title: 'Handle a walk-in',
		description: 'Seat a party that has just arrived without a booking.',
		role: 'server',
		steps: [
			{
				title: 'Go to the live Floor',
				body: 'The Floor Plan shows the room right now — every table with who is sitting there. This is where you seat and clear parties during service.',
				path: '/admin/floor'
			},
			{
				title: 'Find a free table',
				body: 'Free tables read as available (colour-coded by status). For "where can I fit a walk-in of 4 right now?" ask the assistant — it checks live occupancy and predicted free times and names a table.'
			},
			{
				title: 'Seat the walk-in',
				body: 'Tap a free table and choose to seat the walk-in there, entering the party size. On the Diary you can also single-click an empty cell to drop a walk-in instantly at that time.'
			},
			{
				title: 'If nothing is free, use the waitlist',
				body: 'When the room is full, add the party to the waitlist with a rough wait. When a table frees you can notify them and seat them from the waitlist.'
			},
			{
				title: 'Clear when they leave',
				body: 'When the party leaves, clear their table so it shows free again and the next walk-in or booking can take it.'
			}
		]
	},

	// 3) Add a closure — block a date for holiday / private hire.
	{
		id: 'add-closure',
		title: 'Add a closure',
		description: 'Block a date so guests cannot book it online.',
		role: 'manager',
		steps: [
			{
				title: 'Open the Closures calendar',
				body: 'Closures block online bookings for a date — holidays, private hire, maintenance. A closed day shows a red "Closed" banner on the Diary.',
				path: '/admin/closures'
			},
			{
				title: 'Pick the date',
				body: 'Use the calendar to find the day you want to block. Click "+ New" to start a fresh closure, or click a day to work with it.',
				selector: '.cal'
			},
			{
				title: 'Fill in the closure',
				body: 'In the form, set the kind (holiday, private hire, maintenance), the date or date range, and whether it blocks the whole day or just one service. You can also scope it to a single section for a private party while the rest of the room trades.',
				selector: '.cform'
			},
			{
				title: 'Save it',
				body: 'Click "Add closure". The date is now blocked online and the Diary shows it closed. Remove a closure later from the list to reopen the date.',
				selector: '.cform .primary',
				waitForClick: true
			}
		]
	},

	// 4) Set up a deposit rule — back-office policy.
	{
		id: 'deposit-rule',
		title: 'Set up a deposit rule',
		description: 'Require a deposit for large parties or peak nights.',
		role: 'manager',
		steps: [
			{
				title: 'Open Deposit rules',
				body: 'Deposit rules decide when guests must pay a deposit to book — for example £10 per head for parties of 6+, or £5pp on Friday and Saturday nights. They are priority-ordered: the first matching rule wins.',
				path: '/admin/settings/deposits'
			},
			{
				title: 'Start a new rule',
				body: 'Click "+ New" to open the rule form on the right.',
				selector: '.paneltop .link',
				waitForClick: true
			},
			{
				title: 'Set the conditions and amount',
				body: 'Choose which bookings the rule applies to — minimum party size, days of the week, service — and the deposit amount per head. You can link a promotion whose terms are shown to the guest.',
				selector: '.rform'
			},
			{
				title: 'Save the rule',
				body: 'Save it. From now on, matching bookings ask the guest for that deposit before they can confirm online. You can also ask the assistant to "add a £10pp deposit for 6+" and confirm the change.'
			}
		]
	},

	// 5) Read the diary during service — situational awareness, no writes.
	{
		id: 'read-diary',
		title: 'Read the diary during service',
		description: 'Understand the timeline and spot who needs attention.',
		role: 'server',
		steps: [
			{
				title: 'Open the Diary',
				body: 'During service the Diary is your map: sections down the side, each table a row, bookings as bars across the time axis.',
				path: '/admin/diary'
			},
			{
				title: 'Read the colours',
				body: 'A booking bar\'s colour is its arrival status — to arrive, arrived (seated), running late, partially seated, left, or no-show. At a glance you can see who is in and who you are still waiting on.'
			},
			{
				title: 'Spot who is late',
				body: 'Parties past their booking time but not yet seated stand out as late. Ask the assistant "is anyone running late?" for a chase-list with table and minutes overdue.'
			},
			{
				title: 'Open a booking\'s details',
				body: 'Click a bar to open its card — party, phone, notes, allergies and actions (confirm, seat, cancel, print, resend). Everything you need for that guest is on that card.'
			},
			{
				title: 'Make changes safely',
				body: 'Drag a bar to move it, drag an edge to resize, or drag one booking onto another to swap tables. Changes stage in a Confirm bar and only commit when you confirm them — so you can line up several and apply together.'
			}
		]
	},

	// 6) Change site content — the CMS + assistant-assisted editing.
	{
		id: 'change-content',
		title: 'Change site content',
		description: 'Edit the words, offers and images on the public website.',
		role: 'manager',
		steps: [
			{
				title: 'Open Content',
				body: 'The Content page is the website CMS — the actual copy, offers, reviews, menus, gallery and hero videos/images on the public site, editable per brand.',
				path: '/admin/content'
			},
			{
				title: 'Pick what to change',
				body: 'Content opens on an overview of the public site, screen by screen — front door, home page, menus, each interior page. Click the screen you want and it takes you to the right editor. The tabs along the top are the same editors if you already know where you are going. Photos and video all live on the "Photos & video" tab, which shows both restaurants together.'
			},
			{
				title: 'Let the assistant draft it',
				body: 'The fastest way: ask the assistant (bottom-right) to "rewrite our about text to be warmer" or "add a summer offer". It writes the copy and opens a pre-filled editor in the chat.'
			},
			{
				title: 'Review and Save',
				body: 'Nothing goes live until you Save. Read the assistant\'s draft, tweak the wording, then Save. For a new image or video, the editor lets you pick or upload the file.'
			},
			{
				title: 'The announcement banner',
				body: 'To put up an awards / news strip across the top of the site, use the Banner control (or ask the assistant to "announce X on the site"). It is separate from the page copy.'
			}
		]
	}
];

/** Look up a tour by id. */
export function tourById(id: string): Tour | undefined {
	return TOURS.find((t) => t.id === id);
}

/** All tour ids (handy for the system prompt + validation). */
export const TOUR_IDS = TOURS.map((t) => t.id);
