// Page-context map for the admin assistant.
//
// One pure-data table shared by BOTH the client store (assistant.svelte.ts, which
// shows suggestion chips and tags each message with where the operator is) and the
// server endpoint (/api/admin-chat, which biases the system prompt toward the tools
// that matter on that page). It imports nothing from $lib/server, so it is safe in
// either bundle.
//
// Matching is by pathname prefix. The admin routes live under route groups
// ((service)/(guests)) but those parens are stripped from the URL, so the public
// paths used here are the real ones (/admin/floor, /admin/customers, …).

export type AdminPageKey =
	| 'dashboard'
	| 'floor'
	| 'diary'
	| 'runsheet'
	| 'floor-editor'
	| 'tables'
	| 'customers'
	| 'comms'
	| 'reviews'
	| 'settings'
	| 'pacing'
	| 'closures'
	| 'reports'
	| 'content'
	| 'other';

export type Suggestion = {
	/** Chip label shown in the UI. */
	label: string;
	/** The message sent to the assistant when the chip is clicked. */
	prompt: string;
};

type PageMeta = {
	key: AdminPageKey;
	/** Human label for the page (used in the system-prompt hint). */
	label: string;
	/** One line telling the model what the operator is looking at + which tools to
	 *  bias toward. Empty for pages with no special bias. */
	guidance: string;
	/** Up to ~4 starter chips offering things the assistant can do here. */
	suggestions: Suggestion[];
};

// Ordered most-specific first so prefix matching picks the right page (e.g.
// /admin/customers/[id] still resolves to the customers page; /admin must be last
// because every admin path starts with it).
const PAGES: { prefix: string; meta: PageMeta }[] = [
	{
		prefix: '/admin/floor-editor',
		meta: {
			key: 'floor-editor',
			label: 'Floor Editor',
			guidance:
				'The operator is in the FLOOR EDITOR, designing the room layout. Bias toward create_table, update_table, delete_table, save_layout, set_shapes (walls/zones) and manage_floor. This is layout design, not live seating — do not seat or move bookings here.',
			suggestions: [
				{ label: 'Add a table', prompt: 'Add a new table to this floor.' },
				{
					label: 'Rename / resize a table',
					prompt: 'Help me rename or resize a table on this floor.'
				},
				{ label: 'Draw a wall', prompt: 'I want to add a wall to mark off part of the room.' },
				{ label: 'Add a floor', prompt: 'Create a new floor for this restaurant.' }
			]
		}
	},
	{
		prefix: '/admin/floor',
		meta: {
			key: 'floor',
			label: 'Floor Plan (live)',
			guidance:
				'The operator is on the LIVE FLOOR PLAN during service. Bias toward seat_booking, clear_table, move_booking, join_tables, unjoin_tables and seat_walkin. Check the live floor with get_floor_plan first.',
			suggestions: [
				{ label: 'Move a party', prompt: 'I need to move a seated party to a different table.' },
				{ label: 'Seat a walk-in', prompt: 'Seat a walk-in of 2 at a free table.' },
				{ label: 'Where can I fit 6?', prompt: 'Where can I fit a party of 6 right now?' },
				{ label: 'Join two tables', prompt: 'Join two adjacent tables for a larger party.' }
			]
		}
	},
	{
		prefix: '/admin/diary',
		meta: {
			key: 'diary',
			label: 'Diary',
			guidance:
				'The operator is on the DIARY - the service timeline (tables grouped by section, bookings as bars across time). Bias toward get_diary (the whole timeline by section), find_table_gaps (free windows to drop a walk-in / move a party), who_is_late (parties past their slot, unseated), suggest_seating (fit a party at a time, returns exact tables) and get_service_periods. For changes use amend_booking, cancel_booking, mark_no_show, seat_walkin, move_booking - all confirm-gated.',
			suggestions: [
				{ label: 'How is the diary?', prompt: 'Walk me through today by section - who is in and how full are we?' },
				{ label: 'Who is late?', prompt: 'Is anyone running late or unseated past their booking time?' },
				{
					label: 'Fit a walk-in of 4',
					prompt: 'Where can I drop a walk-in of 4 right now? Show me free tables and times.'
				},
				{ label: 'Empty tables at 8?', prompt: 'Which tables are empty around 8pm tonight?' }
			]
		}
	},
	{
		prefix: '/admin/runsheet',
		meta: {
			key: 'runsheet',
			label: 'Run-sheet',
			guidance:
				'The operator is on the RUN-SHEET (print view for kitchen/FOH). Bias toward get_bookings_for_day and get_allergy_summary; highlight allergies, dietary needs and VIPs.',
			suggestions: [
				{
					label: 'Allergy alerts today',
					prompt: 'List today’s bookings with allergy or dietary alerts.'
				},
				{ label: 'VIPs in tonight', prompt: 'Which guests booked tonight are VIPs?' }
			]
		}
	},
	{
		prefix: '/admin/tables',
		meta: {
			key: 'tables',
			label: 'Tables',
			guidance:
				'The operator is on the TABLES admin (table catalogue, joins, fill order). Bias toward list_tables, create_table, update_table, delete_table, join_tables and unjoin_tables.',
			suggestions: [
				{ label: 'Add a table', prompt: 'Add a new table to the catalogue.' },
				{ label: 'Make two tables combinable', prompt: 'Mark two tables as combinable (a join).' }
			]
		}
	},
	{
		prefix: '/admin/customers',
		meta: {
			key: 'customers',
			label: 'Customers',
			guidance:
				'The operator is in the CUSTOMERS directory / a guest profile. Bias toward search_customers and get_customer_history (surface no-show/cancel counts and VIP status).',
			suggestions: [
				{ label: 'Find a guest', prompt: 'Find a customer by name.' },
				{ label: 'Guest history', prompt: 'Show me a guest’s booking history and no-show count.' }
			]
		}
	},
	{
		prefix: '/admin/comms',
		meta: {
			key: 'comms',
			label: 'Guest Comms',
			guidance:
				'The operator is in GUEST COMMS (the AI-drafted outbox). Bias toward draft_message for reminders, thank-yous, win-backs and occasion messages.',
			suggestions: [
				{
					label: 'Draft a thank-you',
					prompt: 'Draft a thank-you message for a guest who dined recently.'
				},
				{ label: 'Draft a win-back', prompt: 'Draft a win-back message for a lapsed regular.' }
			]
		}
	},
	{
		prefix: '/admin/reviews',
		meta: {
			key: 'reviews',
			label: 'Reviews',
			guidance:
				'The operator is on REVIEWS (sentiment + AI reply drafts). Use get_review_insights to summarise themes, and draft_review_reply to draft an on-brand PUBLIC reply to a specific review (drafts only — they post it themselves).',
			suggestions: [
				{
					label: 'Summarise sentiment',
					prompt: 'Summarise the sentiment and themes in recent reviews.'
				},
				{
					label: 'Draft a reply',
					prompt: 'Draft an on-brand reply to this review: [paste the review text here]'
				}
			]
		}
	},
	{
		prefix: '/admin/pacing',
		meta: {
			key: 'pacing',
			label: 'Table rules',
			guidance:
				'The operator is on PACING (covers caps / lead time / booking window). Read the current rules with list_pacing_rules, and CREATE or REMOVE caps with create_pacing_rule / delete_pacing_rule (confirm-gated). The related lead-time / booking-window settings are open_settings. Explain rule precedence.',
			suggestions: [
				{
					label: 'Explain pacing rules',
					prompt: 'Explain how the current pacing rules cap covers.'
				},
				{
					label: 'Cap covers per slot',
					prompt: 'Cap covers at 20 per 15-minute slot on Friday and Saturday nights.'
				}
			]
		}
	},
	{
		prefix: '/admin/closures',
		meta: {
			key: 'closures',
			label: 'Closures',
			guidance:
				'The operator is on the CLOSURES calendar (holidays / private hire / maintenance). Explain how to add a closure that blocks bookings for a date range.',
			suggestions: [{ label: 'Add a closure', prompt: 'Block out a date for a private hire.' }]
		}
	},
	{
		prefix: '/admin/reports',
		meta: {
			key: 'reports',
			label: 'Reports',
			guidance:
				'The operator is on REPORTS. Bias toward get_covers_report and get_noshow_report over a date range — and prefer show_report (metric "covers" or "noshow") to render the figures as a visual card beside the chat rather than a wall of prose.',
			suggestions: [
				{ label: 'Covers this week', prompt: 'Show me a covers report for the last 7 days.' },
				{ label: 'No-show rate', prompt: 'Show me the no-show rate over the last 30 days.' }
			]
		}
	},
	{
		prefix: '/admin/content',
		meta: {
			key: 'content',
			label: 'Content',
			guidance:
				'The operator is in the CONTENT editor (the website CMS). When they want to change any copy, offers, reviews, videos/images, menus or the gallery, WRITE the new copy yourself and call open_content with the key and the full updated blob to bring a pre-filled editor to them (they review and Save). For a new image/video, call open_content with key "media" and no value. Use get_content to read the current copy first. The announcement banner is separate — use get_banner/set_banner.',
			suggestions: [
				{
					label: 'Rewrite the about text',
					prompt: 'Rewrite our About / brand description to be warmer and more inviting.'
				},
				{
					label: 'Freshen the home copy',
					prompt: 'Suggest improved wording for the home-page hero and statement copy.'
				},
				{ label: 'Change a video / image', prompt: 'I want to change the hero video.' },
				{ label: 'Add an offer', prompt: 'Add a new offer to the offers strip.' }
			]
		}
	},
	{
		prefix: '/admin/settings',
		meta: {
			key: 'settings',
			label: 'Settings',
			guidance:
				'The operator is in SETTINGS. When they want to change anything, call open_settings for the relevant keys (bring the controls to them) and give a short numbered how-to.',
			suggestions: [
				{
					label: 'Change max party size',
					prompt: 'I want to change the maximum party size guests can book online.'
				},
				{ label: 'Adjust deposit', prompt: 'Help me adjust the deposit for large parties.' },
				{ label: 'No-show fee', prompt: 'Change the no-show fee for Friday and Saturday nights.' }
			]
		}
	},
	{
		prefix: '/admin',
		meta: {
			key: 'dashboard',
			label: 'Dashboard',
			guidance:
				'The operator is on the DASHBOARD (today at a glance). Good starting point for get_dashboard, get_alerts, and planning the evening. For "who\'s in tonight" prefer show_bookings to render a scannable table. Use navigate_to to jump them to another page.',
			suggestions: [
				{
					label: 'Who’s in tonight?',
					prompt: 'Show me tonight’s bookings.'
				},
				{
					label: 'Anything to watch?',
					prompt: 'Are there any operational alerts or risky bookings I should know about?'
				},
				{ label: 'Where can I fit 6?', prompt: 'Where can I fit a party of 6 tonight?' }
			]
		}
	}
];

const OTHER: PageMeta = {
	key: 'other',
	label: 'Admin',
	guidance: '',
	suggestions: [
		{
			label: 'Today at a glance',
			prompt: 'Give me today’s bookings, covers and anything awaiting payment.'
		},
		{ label: 'Where can I fit a party?', prompt: 'Where can I fit a party of 6 tonight?' }
	]
};

/** Resolve a pathname to its page meta (prefix match, most-specific first). */
export function pageMetaFor(pathname: string | undefined | null): PageMeta {
	if (!pathname) return OTHER;
	for (const p of PAGES) {
		if (pathname === p.prefix || pathname.startsWith(p.prefix + '/') || pathname === p.prefix) {
			return p.meta;
		}
	}
	return OTHER;
}

/** The one-line system-prompt guidance for a page key (used server-side to bias
 *  the assistant toward the right tools). Empty string when the key is unknown or
 *  the page has no special bias. */
export function guidanceForKey(key: string | undefined | null): string {
	if (!key) return '';
	if (key === OTHER.key) return OTHER.guidance;
	const hit = PAGES.find((p) => p.meta.key === key);
	return hit ? hit.meta.guidance : '';
}

/** Compact context the client sends to the endpoint with each ask. */
export type AssistantPageContext = { key: AdminPageKey; label: string };
