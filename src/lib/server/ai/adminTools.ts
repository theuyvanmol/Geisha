// Back-compat shim. The admin assistant's tools now live in per-domain modules
// under ./tools/, joined by the composer in ./tools/index.ts (WP-S6-1). This file
// keeps the original surface so /api/admin-chat is unchanged until WP-S6-5 threads
// the real session context: adminTools(brand, nowISO) builds a default
// ToolContext (actor='ai') and delegates to the composer.

import type { BrandId } from '$lib/server/db/types.js';
import type { GeminiTool } from './geminiAgent.js';
import { adminTools as composeAdminTools, type ToolContext } from './tools/index.js';

export { SETTING_META, settingsCatalogue, type SettingWidget } from './tools/index.js';

/** Build the admin tool set for a brand. `nowISO` is the moment of the request.
 *  Writes audit as actor='ai' until WP-S6-5 threads the real staff context. */
export function adminTools(brand: BrandId, nowISO: string): GeminiTool[] {
	const ctx: ToolContext = { brand, nowISO, actor: 'ai' };
	return composeAdminTools(ctx);
}
