// Editable copy for this page (admin → Content → Pages), plus the brand_info the
// {token} placeholders in that copy resolve against.
import { loadPageCopy } from '$lib/server/content/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => loadPageCopy('fusion');
