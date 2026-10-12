// Composer (barrel) for the admin assistant's tool catalogue. Each domain module
// exports a factory `xxxTools(ctx): GeminiTool[]`; this concatenates them into the
// full set the agent loop is handed. This is the single merge point: a new stream
// adds ONE domain module and registers it here once — no other file changes, and
// existing tools keep their identity (dispatch is by name in the agent loop).
//
// The insights module additionally carries the MOONSHOT read tools (mf-*),
// including the capstone propose_evening_plan (mf-autonomous-copilot) — all
// spread in via insightTools, so registering remains a single import here.
//
// The set reproduces the original adminTools.ts plus the WP-S6-2 booking
// lifecycle and WP-S6-3 floor lifecycle:
// check_availability, get_bookings_for_day, get_booking_detail,
// get_bookings_range, get_floor_plan, get_tables_freeing_next, list_tables,
// list_floors, list_settings
// (read); open_settings (ui); create_booking, amend_booking, cancel_booking,
// mark_no_show, seat_booking, clear_table, seat_walkin, move_booking,
// join_tables, unjoin_tables, create_table, update_table, delete_table,
// save_layout, manage_floor, set_shapes, update_setting (write).
// S6-2 OWNS the booking create/cancel/seat lifecycle.

import type { GeminiTool, ToolContext } from './types.js';
import { bookingTools } from './toolsBookings.js';
import { floorTools } from './toolsFloor.js';
import { diaryTools } from './toolsDiary.js';
import { customerTools } from './toolsCustomers.js';
import { waitlistTools } from './toolsWaitlist.js';
import { closureTools } from './toolsClosures.js';
import { paymentTools } from './toolsPayments.js';
import { settingTools } from './toolsSettings.js';
import { reportTools } from './toolsReports.js';
import { insightTools } from './toolsInsights.js';
import { bannerContentTools } from './toolsContentBanner.js';
import { contentTools } from './toolsContent.js';
import { navTools } from './toolsNav.js';
import { cardTools } from './toolsCards.js';
// Onboarding / training: explain_page (read) + start_tour (ui).
import { trainingTools } from './toolsTraining.js';

// Re-export the settings metadata the system prompt + UI consume, so callers can
// keep importing them from one place.
export { SETTING_META, settingsCatalogue } from './toolsSettings.js';
export type { SettingWidget } from './toolsSettings.js';
// Content metadata (system-prompt vocabulary + the inline editor descriptor).
export { CONTENT_META, contentCatalogue } from './toolsContent.js';
export type { ContentWidgetDescriptor, ContentEditor, ContentEditorKey } from './toolsContent.js';
export type { ToolContext } from './types.js';

/** Build the full admin tool set for a request context. */
export function adminTools(ctx: ToolContext): GeminiTool[] {
	return [
		...bookingTools(ctx),
		...floorTools(ctx),
		...diaryTools(ctx),
		...customerTools(ctx),
		...waitlistTools(ctx),
		...closureTools(ctx),
		...paymentTools(ctx),
		...settingTools(ctx),
		...reportTools(ctx),
		...insightTools(ctx),
		...bannerContentTools(ctx),
		...contentTools(ctx),
		// navigate_to (ui) + show_bookings/show_report visual result cards (ui).
		...navTools(ctx),
		...cardTools(ctx),
		// explain_page (read) + start_tour (ui) — onboarding / training.
		...trainingTools(ctx)
	];
}
