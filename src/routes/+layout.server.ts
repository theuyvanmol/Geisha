// Lock the public site to on-demand SSR. Editable content (galleries, menus,
// text) is read from PocketBase per request, so the pages must NOT be
// prerendered — a prerendered page would freeze the content at build time and
// silently ignore admin edits until the next deploy. Do not set `prerender`
// true anywhere under the public routes. (The admin area sets its own flags.)
export const prerender = false;
