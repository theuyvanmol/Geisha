// Per-brand settings for the post-visit feedback email (geisha_settings
// `guest_feedback`). A missing row means "on, no Google button".
//
// Two readers, on purpose:
//   • getGuestFeedbackConfig — for pages. Never throws; an unreadable setting
//     reads as the defaults, so a settings screen or a guest's thank-you page
//     still renders.
//   • getGuestFeedbackConfigForSend — for the cron. Throws unless the row is
//     either READ or genuinely ABSENT, so a database hiccup at 10:00 can't turn
//     "the owner switched these off" into "on by default" and email everyone.

import { pb } from '../db/pb.js';
import { getSettingValue, setSettingByKey } from '../booking/admin.js';
import type { BrandId, Setting } from '../db/types.js';
import {
	GUEST_FEEDBACK_KEY,
	normaliseGuestFeedbackConfig,
	type GuestFeedbackConfig
} from './rules.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export async function getGuestFeedbackConfig(brand: BrandId): Promise<GuestFeedbackConfig> {
	try {
		return normaliseGuestFeedbackConfig(await getSettingValue(brand, GUEST_FEEDBACK_KEY));
	} catch {
		return normaliseGuestFeedbackConfig(undefined);
	}
}

export async function getGuestFeedbackConfigForSend(
	restaurantId: string
): Promise<GuestFeedbackConfig> {
	const c = await pb();
	try {
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurantId)} && key=${q(GUEST_FEEDBACK_KEY)}`);
		return normaliseGuestFeedbackConfig(row.value);
	} catch (err) {
		if ((err as { status?: number })?.status === 404) return normaliseGuestFeedbackConfig(undefined);
		throw err;
	}
}

export async function setGuestFeedbackConfig(
	brand: BrandId,
	config: GuestFeedbackConfig,
	staffId: string
): Promise<GuestFeedbackConfig> {
	const clean = normaliseGuestFeedbackConfig(config);
	await setSettingByKey(brand, GUEST_FEEDBACK_KEY, clean, 'staff', staffId);
	return clean;
}
