// Per-page "Explain this page" training content for the admin back-office.
//
// One pure-data table keyed by AdminPageKey (from pageContext.ts), describing what
// each admin page is FOR, the key tasks a member of staff does there, and a few
// practical tips. It is consumed by BOTH:
//   · the server tool `explain_page` (src/lib/server/ai/tools/toolsTraining.ts),
//     which returns the entry so the assistant can narrate the page in chat; and
//   · (potentially) client surfaces that want to render the same copy directly.
//
// ⚠️ CLIENT-SAFE. Like pageContext.ts this imports NOTHING from $lib/server, so it
// is safe in either bundle. It is intentionally plain data (no runes, no fetch) so
// it can be imported from a +server.ts tool module OR a .svelte component alike.
//
// Keep the keys in lockstep with AdminPageKey in pageContext.ts. A page with no
// bespoke entry falls back to the generic 'other' entry via explainFor().

import type { AdminPageKey } from './pageContext';

/** What a member of staff needs to know to use one admin page. */
export type PageTraining = {
	/** The friendly page title (matches pageContext's label where possible). */
	title: string;
	/** One or two sentences: what this page is for / when you come here. */
	whatItIsFor: string;
	/** The main things staff DO on this page, most-common first. */
	keyTasks: string[];
	/** Short practical pointers, gotchas and shortcuts. */
	tips: string[];
};

// Grounded in the real routes and behaviours of this app (diary timeline, live
// floor, closures calendar, deposit rules, the CMS, the assistant itself…). Copy
// is written for a host/manager reading it mid-shift — concrete, not marketing.
export const TRAINING: Record<AdminPageKey, PageTraining> = {
	dashboard: {
		title: 'Dashboard',
		whatItIsFor:
			'Your home base — today at a glance. It shows the shape of the day (bookings, covers, anything awaiting payment) and any operational alerts before you dive into a specific page.',
		keyTasks: [
			'Read the day: how many covers are booked, how full each service is.',
			'Scan alerts — risky bookings, unpaid deposits, allergy flags.',
			'Jump to the page you need next (Diary, Floor, Reports).'
		],
		tips: [
			'Ask the assistant "who\'s in tonight?" and it renders a scannable table right here.',
			'Use "plan tonight" (manager+) to get a pre-service checklist of seating moves and guests to chase.',
			'This is a read-only overview — you make changes on the Diary, Floor and Settings pages.'
		]
	},
	floor: {
		title: 'Floor Plan (live)',
		whatItIsFor:
			'The live room during service — every table with who is sitting there right now. This is where you seat, move and clear parties as the shift runs.',
		keyTasks: [
			'Seat an arriving booking or a walk-in at a free table.',
			'Move a seated party to a different table.',
			'Clear a table when guests leave so it shows free again.',
			'Join two adjacent tables for a bigger party.'
		],
		tips: [
			'Table colours show arrival status: to-arrive, seated, running late, left.',
			'For "where can I fit 6 right now?" ask the assistant — it checks live occupancy and predicted free times.',
			'This is live seating, not layout design — to add or reshape tables use the Floor Editor.'
		]
	},
	diary: {
		title: 'Diary',
		whatItIsFor:
			'The service timeline you run the shift from — tables grouped by section down the side, bookings as bars across time. Everything about the book for a given day lives here.',
		keyTasks: [
			'Take a new booking or drop in a walk-in at the right time and table.',
			'Move or resize a booking by dragging its bar; swap two parties by dragging one onto another.',
			'Confirm a guest, mark a no-show, or cancel.',
			'Spot who is running late and needs chasing.'
		],
		tips: [
			'Staged changes (moves/resizes/swaps) collect in a Confirm bar — nothing is written until you confirm, and they commit together.',
			'A single click on an empty table cell drops a walk-in instantly at that time.',
			'A red "Closed" banner means the day (or a section) is blocked — check Closures.',
			'The diary live-syncs across devices, so another host\'s changes appear without a refresh.'
		]
	},
	runsheet: {
		title: 'Run-sheet',
		whatItIsFor:
			'A print-friendly summary of the day for the kitchen and front-of-house — the bookings, party sizes, allergies, dietary needs and VIPs, ordered for a pre-service brief.',
		keyTasks: [
			'Print or read the running order before doors.',
			'Flag allergy and dietary alerts to the kitchen.',
			'Note which guests are VIPs or have special occasions.'
		],
		tips: [
			'Ask the assistant to "list today\'s allergy alerts" for a quick verbal brief.',
			'This is a read-out of the diary — change bookings on the Diary page, not here.'
		]
	},
	'floor-editor': {
		title: 'Floor Editor',
		whatItIsFor:
			'Where you DESIGN the room — the physical layout of tables, walls and zones across one or more floors. This is setup, not live service.',
		keyTasks: [
			'Add, rename, resize, move or rotate a table.',
			'Draw walls and mark off zones or areas.',
			'Set which tables can be joined together (combinable pairs).',
			'Add or manage a floor.'
		],
		tips: [
			'Changes here shape what the live Floor and Diary show — get the layout right before service.',
			'It works in real centimetres with snap-to-join, so joined tables line up cleanly.',
			'Never edit the layout mid-service on a busy night — you are moving the map the whole team is reading.'
		]
	},
	tables: {
		title: 'Tables',
		whatItIsFor:
			'The table catalogue — the list of every table with its seats, section and join rules, and the fill order the auto-allocator uses.',
		keyTasks: [
			'Add a table or edit its seat range and section.',
			'Mark two tables as combinable (a join) or set up a chain.',
			'Tune the order tables get filled in.'
		],
		tips: [
			'Joins (chains) here drive automatic allocation — a party of 6 can be given a joined pair without a human deciding.',
			'Staff can still manually join any two tables on the live Floor even if they aren\'t a preset chain.'
		]
	},
	customers: {
		title: 'Guests',
		whatItIsFor:
			'The guest directory / CRM — search for a customer and open their profile to see history, VIP status, tags, allergies and notes.',
		keyTasks: [
			'Find a guest by name, phone or email.',
			'Read their booking history and no-show / cancellation count.',
			'Mark a VIP, add tags, record allergies or notes.'
		],
		tips: [
			'Check the no-show count before waiving a deposit for a large party.',
			'Ask the assistant to draft a thank-you or win-back message for a guest from here (it goes to the Comms outbox to send).',
			'Allergies and tags REPLACE the whole list when you save — read the current ones first if you are just adding.'
		]
	},
	comms: {
		title: 'Guest Comms',
		whatItIsFor:
			'The AI-drafted outbox for guest messages — reminders, thank-yous, win-backs and occasion notes. Nothing sends until you approve it.',
		keyTasks: [
			'Draft a message to a guest (or ask the assistant to draft one).',
			'Review the wording, tweak it, and send.'
		],
		tips: [
			'The assistant writes the first draft — you always get to edit before it goes out.',
			'Nothing is ever sent automatically from here.'
		]
	},
	reviews: {
		title: 'Reviews',
		whatItIsFor:
			'Guest review sentiment plus AI-drafted public replies. See the themes in recent feedback and draft an on-brand response to a specific review.',
		keyTasks: [
			'Read a summary of recent sentiment and recurring themes.',
			'Draft a reply to a single review (paste the text, pick a tone).',
			'Post the reply yourself once you are happy with it.'
		],
		tips: [
			'The assistant only DRAFTS a reply — you review and publish it; nothing posts automatically.',
			'Ask for "the themes in recent reviews" to brief the team on what guests are noticing.'
		]
	},
	settings: {
		title: 'Settings',
		whatItIsFor:
			'The policy and configuration for online booking — max party size, deposit amounts, no-show fees, lead time, booking window and integrations.',
		keyTasks: [
			'Change the maximum party guests can book online.',
			'Adjust deposit amounts and no-show fees.',
			'Set lead time and how far ahead guests can book.'
		],
		tips: [
			'Ask the assistant to change a setting and it brings the exact controls into the chat, pre-filled, for you to review and Save.',
			'Deposit and no-show £ figures are in pence behind the scenes (1000 = £10).',
			'The detailed priority-ordered deposit rules live under Settings → Deposits, separate from the headline figures.'
		]
	},
	pacing: {
		title: 'Table rules',
		whatItIsFor:
			'Covers caps and booking flow control — limit how many covers can be booked per 15-minute slot or per service, plus lead time and booking window. The Policy, Deposits, Set Menus and Integrations settings sit on tabs across the top of this same page.',
		keyTasks: [
			'Cap covers per slot (e.g. 20 covers every 15 minutes on Friday nights).',
			'Cap covers per whole service.',
			'Remove a cap that is no longer needed.'
		],
		tips: [
			'Caps stop the kitchen getting hit by too many tables at once — pace the room, not just the day.',
			'Ask the assistant to "cap covers at 20 per slot on Fri/Sat" and it proposes the rule for you to confirm.',
			'The house turn-time ladder (how long each party size holds a table) is authoritative and set elsewhere.'
		]
	},
	closures: {
		title: 'Closures',
		whatItIsFor:
			'The calendar of blocked dates — holidays, private hire, maintenance. A closure stops online bookings for a date, a range, or a single service.',
		keyTasks: [
			'Block out a whole day (e.g. a bank holiday).',
			'Block one service (just dinner) or a date range.',
			'Close a single section for a private party while the rest trades.',
			'Reopen a date by removing the closure.'
		],
		tips: [
			'A closure shows as a red "Closed" banner on the Diary for that day.',
			'To hold a whole area for a private party, ask the assistant to "book out the [section]".'
		]
	},
	reports: {
		title: 'Reports',
		whatItIsFor:
			'The numbers — covers over a date range, no-show and cancellation rates by channel, deposits and guest feedback. Manager-level insight into how the room is trading.',
		keyTasks: [
			'Pull a covers report for a week or month.',
			'Check the no-show rate and where the no-shows come from.',
			'Review deposits taken and refunded.'
		],
		tips: [
			'Ask the assistant to "show covers this week" and it renders the figures as a visual card beside the chat.',
			'These commercial figures are manager+ only.'
		]
	},
	content: {
		title: 'Content',
		whatItIsFor:
			'The website CMS — the actual words, offers, reviews, menus, gallery and hero videos/images on the public site, editable per brand.',
		keyTasks: [
			'Rewrite copy (about text, home-page hero, statements).',
			'Add or edit an offer, a featured review, or a menu item.',
			'Swap a hero video or a feature image.',
			'Put up or take down the site announcement banner.'
		],
		tips: [
			'Ask the assistant to rewrite something and it brings a pre-filled editor into the chat — nothing goes live until you Save.',
			'The announcement banner (awards / news strip) is a separate control from the site copy.',
			'Menus and the gallery open as structured editors because they are large — the assistant can still pre-fill your edits.'
		]
	},
	other: {
		title: 'Admin',
		whatItIsFor:
			'The Geisha back-office. The sidebar carries the everyday pages — Service (Floor, Diary, Run-sheet), Tables, Reports, Table rules and Team, with Guests and the Assistant below them. Everything else — Dashboard, Floor Editor, Training, Content, Closures and your own account — is on the Other page at the bottom.',
		keyTasks: [
			'Pick a page from the sidebar for the job you need to do.',
			'Ask the assistant (bottom-right, or Cmd/Ctrl-K) to do a task or explain a page.'
		],
		tips: [
			'The assistant can explain any page and walk you through common tasks — just ask.',
			'Guided tours live under Training if you are new to the system.'
		]
	}
};

/** The training entry for a page key, falling back to the generic 'other' entry. */
export function explainFor(key: AdminPageKey | string | null | undefined): PageTraining {
	if (key && key in TRAINING) return TRAINING[key as AdminPageKey];
	return TRAINING.other;
}
