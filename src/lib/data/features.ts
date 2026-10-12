// Site feature flags — things that are built but not open to guests yet.
//
// One constant per feature, read by every surface that links to it (public nav,
// footer, admin sidebar, the page itself), so switching a feature on is a
// one-line change here rather than a hunt through components for links to
// un-grey. Deliberately compile-time constants, not settings rows: these are
// launch decisions, not something to toggle per service.

/**
 * The Circle — the loyalty / rewards programme.
 *
 * Built and admin-editable (/admin/circle), but not launched: no cards issued,
 * no points to redeem. Until it is, guests see the nav entry greyed out with a
 * "Coming soon" tag and the page itself explains that, rather than advertising a
 * scheme nobody can join.
 */
export const CIRCLE_LIVE = false;

/**
 * The Gallery page (/asia/gallery, /fusion/gallery).
 *
 * Hidden for now on both restaurants (owner, Oct 2026): no nav, footer or home
 * page link, out of the sitemap, and the two URLs send a guest to that
 * restaurant's home page. The page, its photos and the admin Gallery editor are
 * all untouched, so `true` brings it straight back.
 */
export const GALLERY_PAGE_LIVE = false;

/** Tag shown against a not-yet-launched item. */
export const COMING_SOON = 'Coming soon';
