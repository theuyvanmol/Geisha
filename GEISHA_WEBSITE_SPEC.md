# Geisha Restaurants — Website Rebuild Spec

> A complete crawl + analysis of the two existing live sites
> (`geisharestaurants.co.uk/fusion/` and `geisharestaurants.co.uk/asia/`),
> written as a build brief for the new website. Use this to decide which of
> your 3 design versions to run with, and to know exactly what pages,
> content, integrations and features must exist.
>
> Crawled: 2026-06-01

---

## 1. The big picture — what you actually have today

There are **two separate restaurants** that share one brand, one building/address, one ordering account and one set of social channels:

| | **Geisha Asia** | **Geisha Fusion** |
|---|---|---|
| Concept | Modern Japanese-inspired, pan-Asian (sushi, dim sum) | Family-friendly global fusion (burgers, curry, crispy duck, Sunday roast) |
| Phone | 0191 607 1100 | 0191 300 4641 |
| Email | asia@geisharestaurants.co.uk | fusion@geisharestaurants.co.uk |
| Address | Front Street, Benton, Newcastle Upon Tyne, NE12 8AE | Front Street, Benton, Newcastle Upon Tyne, NE12 8AE |
| Hours | Mon–Sun 12pm–11pm (kitchen 9:30pm, last orders 9:15pm) | Mon–Thu 12–10, Fri–Sat 12–11, Sun 12–7:30 (last booking 6pm, excl. bank-holiday weekends) |
| Nearest Metro | Four Lane Ends (0.4mi / 700yd) | Four Lane Ends (0.4mi / 700yd) |
| Visual identity | Dark charcoal, orange accent, stencil/oriental display font, geisha street-art, paper lanterns | Cream/warm, retro-serif wordmark, blossom + lantern photography, red/teal/terracotta blocks |

**Both sites are currently WordPress** (Twenty Twenty child theme) with a stack of plugins (WooCommerce, Smash Balloon Instagram feed, Restaurant-for-WooCommerce, Constant Contact). The rebuild is your chance to drop WordPress and ship a clean, fast, modern site (e.g. SvelteKit) while keeping every integration that matters.

### Recommended architecture for the new build

**Direction (decided): two distinct sites, one shared toolbox — NOT one layout reskinned twice.**

The two restaurants must *feel* different — different vibe, layout, pacing, typography and motion — not just recoloured. They share *pages by purpose* (both need to book, show menus, etc.) but the **experience of each page is designed separately per brand.**

- **Shared = the toolbox (components + integrations), written once:** ResDiary booking embed, gallery + lightbox, mailing-list form, menu renderer, Stripe gift-card checkout, contact form, cookie banner. These do the same *job* on both sites, so they're built once and themed.
- **Different = the sites (layout, arrangement, style, vibe), built per brand:** section order, navigation feel, colours, fonts, photography, motion, copy tone. A booking page uses the same ResDiary embed on both — but Asia's can be a moody full-bleed dark page and Fusion's a bright, warm, playful one, laid out completely differently.
- **Structure:** one codebase, two sub-paths (`/asia`, `/fusion`) to match current URLs/SEO. Brand config still centralises the *data* (phone, email, hours, menus, ResDiary IDs, social links); layout/theme is intentionally per-brand, not generated from a single shared template.

**Vibe direction (starting point — refine when design version is chosen):**

| Lever | Geisha Asia | Geisha Fusion |
|---|---|---|
| Mood | Dark, sleek, refined — date-night / cocktails | Bright, warm, friendly — family, fun, casual |
| Layout | Full-bleed imagery, generous negative space, asymmetric | Bold colour blocks, denser, menu-forward |
| Type | Sharp stencil/oriental display | Retro rounded serif, larger, playful |
| Motion | Subtle fades, slow reveals, parallax | Snappier, more energetic |
| Nav | Minimal / overlay menu | Always-visible, colourful, obvious |
| Photography | Street-art portraits, lanterns, low light | Blossom, plated comfort food, bright interiors |

> **Trade-off (deliberate):** the more the two diverge in layout, the less *layout* is reusable. The *functional components and all integrations stay shared* — that's where the real build/maintenance savings live. This is an accepted trade for a stronger, distinct brand feel per restaurant.

---

## 2. Site map — pages that exist today (per brand)

Each restaurant currently has these pages:

1. **Homepage** (`/asia/`, `/fusion/`)
2. **Bookings** (`/asia/bookings/`, `/fusion/bookings/`) — ResDiary widget
3. **Gift Cards / Gift Voucher** (`/asia/gift-cards/`, `/fusion/gift-cards/`) — WooCommerce
4. **Contact Us** (`/…/contact-us/`) — contact form + details
5. **Parties & Functions / Private Hire** (`/fusion/parties-and-functions/`) — *Fusion only currently; Asia has none*
6. **Privacy & Cookie Policy** (`/…/privacy-policy/`)
7. **Menus** — these are **not pages**, they are direct-linked **PDF files** (see §4)
8. **Takeaway / At Home Experience** — external link to `geisha.touchtakeaway.net/store`

---

## 3. Homepage content & section breakdown

The two homepages share an identical *structure*, only the skin and copy differ. Replicate these sections:

### 3.1 Hero
- Full-width hero image (Asia: geisha portrait over dark texture; Fusion: restaurant interior w/ blossom & lanterns)
- Headline: **"BOOK YOUR TABLE TODAY"**
- Primary CTA button: **"BOOK NOW"** → bookings page

### 3.2 Intro / About block
A coloured panel over a photo with the brand name as heading and an intro paragraph. **Copy verbatim:**

**Asia:**
> "Geisha Asia is a modern, Japanese-inspired restaurant that offers an exquisite dining experience. Our pan-asian menu features delicious sushi, dim-sum as well as a variety of other mouth-watering dishes.
> The unique setting of our restaurant, with its Japanese garden inspired design, is the perfect place to enjoy a meal with family and friends. Whether you're looking for a romantic dinner for two or a fun night out with friends, Geisha is the perfect place to experience the taste sensation of pan-Asian cuisine."

**Fusion:**
> "Embark on a delightful culinary journey at Geisha Fusion! Our family-friendly restaurant presents a vibrant array of dishes from across the globe. Our diverse menu blends classic favourites with modern twists, inspired by a variety of international cuisines. Whether you're in the mood for American-style burger, mouthwatering curry, or crispy aromatic duck, our chefs are ready to serve up the best flavours to delight your palate."
> *(Note: current live copy has typos — "your're", "server" — fix these in the rebuild.)*

### 3.3 Promo / feature banner
A wide promotional banner that changes with the current offer. Both brands use one of these:
- **Asia:** "DAYTIME SPECIAL — Mix & Match Any Two Dishes — ONLY £14.50" + "VIEW MENU" button
- **Fusion:** "TRADITIONAL SUNDAY ROAST — Every Sunday — Served all day 'til it's gone!" + "VIEW MENU" button
> **Make this a CMS-editable / config-driven banner** so staff can swap the current promotion without a developer.

### 3.4 Opening Times block
A coloured panel listing the week's hours (see table in §1). Asia uses pink panel; Fusion uses orange panel over an interior shot.

### 3.5 Mailing list signup
Heading: **"JOIN OUR MAILING LIST"**
Body: "Sign up to our mailing list to be the first to receive news, unique offers and other goodies before anyone else!"
- Asia fields: First Name, Email (required)
- Fusion fields: First Name, Email (required), Birthday (dd/mm/yyyy)
- Consent: "Yes, I would like to receive emails from Geisha. (You can unsubscribe anytime)"
- Button: **"SIGN ME UP"**
- Powered by **Constant Contact** today.

### 3.6 Social / Instagram feed
Heading: **"KEEP IT SOCIAL"** + hashtags **#GEISHARESTAURANT** and **#GEISHAFUSION / #GEISHAASIA**
- Live Instagram feed (currently Smash Balloon plugin), "Load More…" and "Follow on Instagram"
- Facebook + Instagram icons → `facebook.com/geisharestaurants/`, `instagram.com/geisharestaurants/`

### 3.7 Footer (4 columns)
- **VISIT** — name + address
- **CONTACT US** — phone + email
- **OPENING TIMES** — full week
- **ESSENTIALS** — Takeaway / At Home Experience, Book A Table, Parties & Functions (Fusion), Gift Voucher, Contact Us, Privacy & Cookie Policy

---

## 4. Menus — currently 8–10 PDFs per brand

Menus are **PDF downloads**, not web pages. Current set:

**Asia:** Main Menu (A3) · Evening Special · Daytime Special · Bottomless Brunch · 2 for £14 Cocktails · Drinks · Allergen
**Fusion:** Main Menu · Special Menu · Sunday Roast · Dessert · Bottomless Brunch · Kids · Drinks · Allergy

> **Recommendation for the rebuild — biggest opportunity here:**
> 1. **Keep the PDF download** for printing/sharing, **but also render menus as proper HTML pages** (better mobile UX, SEO, accessibility, Google rich results, no pinch-zoom on a phone). A single structured menu data file → renders both the on-page menu and can even generate the PDF.
> 2. Put menus behind clean URLs (`/asia/menus/main`, `/asia/menus/drinks`) instead of dated PDF paths that break every month.
> 3. Build an **allergen/dietary filter** on the HTML menu (the allergen menu is already a separate PDF — turn it into interactive data).

---

## 4a. Gallery (NEW feature)

Both brands are highly visual (geisha street-art, lanterns, blossom, plated food, cocktails, the VIP function room), so a gallery is a high-value addition. It doubles as social proof and as marketing for private hire.

**Chosen approach: filterable grid + lightbox, sourced from BOTH curated uploads and the live Instagram feed.**

### Dedicated Gallery page (`/asia/gallery`, `/fusion/gallery`)
- **Filter chips:** `All · Food · Interior · Cocktails · Events`
- **Masonry grid** of curated photos (mixed heights tile well — food close-ups + wide interiors)
- **Lightbox** on click: full-size view, arrow-key / swipe navigation, Esc to close, focus-trapped for accessibility
- **"Fresh from Instagram" strip** at the bottom — latest @geisharestaurants posts, auto-synced (no manual upkeep)

### Two image sources, two jobs
- **Curated / uploaded photos** = the hero content. Hand-picked, high quality, each tagged with a category so filters work. Fully controlled.
- **Instagram feed** = the always-fresh layer. New posts appear automatically so the page never looks stale.

### Reuse the same component elsewhere (no extra build)
- Interior photo **strip on Parties & Functions** (sells the VIP room)
- Food **carousel on menu pages**
- The home page **"Keep it Social"** block is just the Instagram half of this system — one shared system, not two.

### Data model per curated image
```
{ src, alt, category: "food" | "interior" | "cocktails" | "events", featured?: boolean }
```
Keep images in a per-brand folder or CMS collection; `featured` items can seed the home page / strips.

---

## 5. Integrations & "systems" (keep these — they're the backbone)

| System | Used for | Today | Notes for rebuild |
|---|---|---|---|
| **Bespoke booking system** | Table bookings | **Replacing ResDiary** — custom build, own DB + staff floor plan, Dojo payments | The big workstream. Customer widget themed per brand; deposit/no-show rules in §6. See memory `booking-system-decision`. |
| ~~ResDiary~~ | (being replaced) | Embedded widget on `/bookings/` | Decommissioned in favour of the bespoke system above. |
| **Uber Eats** | Food delivery (partner) | Separate store per brand (see §5a) | **Push prominently across the site (see §5a).** Use official "Order on Uber Eats" badge. |
| **Touch Takeaway** | Online ordering / "At Home Experience" (collection) | External `geisha.touchtakeaway.net/store`, payments via **Sage Pay (Opayo)** | Keep as external link, or evaluate a modern alternative. Single account serves both branches ("Change store"). |
| **Dish Cult** | Alternative booking listing | `dishcult.com/restaurant/geishaasia` | Secondary booking channel — ResDiary remains primary. Optional. |
| **WooCommerce** | Gift vouchers | On-site checkout | Replace with **Dojo** checkout (business already uses Dojo) to drop WP entirely. |
| **Constant Contact** | Mailing list | Embedded form | Keep, or migrate to Mailchimp/Klaviyo. Just POST to their API. |
| **Smash Balloon** | Instagram feed | WP plugin | Replace with Instagram Basic Display API or a lightweight feed component. |
| **Contact form** | Enquiries | WP form → email | Replace with a simple serverless form (e.g. Formspree, Resend, or your own API route). |

---

## 5a. Uber Eats — push the partnership prominently

Both restaurants are **Uber Eats delivery partners**, each with its own store. This is a direct revenue channel and should be surfaced in many places — it's the "order in" counterpart to "dine in" (BOOK NOW).

**Official store links:**
- **Geisha Asia (at Home):** `https://www.ubereats.com/gb/store/geisha-asia-at-home/kNXKTsjHUDGUTtcG8Oif1g`
- **Geisha Fusion:** `https://www.ubereats.com/gb/store/geisha-fusion/LHI0h0B4UiiW21CY-uLEaQ`

> Note: there are now **two ordering routes** — Uber Eats (delivery) and Touch Takeaway (collection / at-home). Present both, with Uber Eats given top billing for delivery.

### Where to place the Uber Eats CTA (push it everywhere relevant)
1. **Header / nav** — "Order on Uber Eats" button alongside BOOK NOW (the two primary actions: dine in vs. order in).
2. **Hero** — secondary CTA under BOOK NOW ("Order Delivery on Uber Eats").
3. **Dedicated "Order Online" page/section** — Uber Eats (delivery) + Touch Takeaway (collection) side by side; Uber on top.
4. **Sticky mobile bar** — persistent bottom bar on phones: `Book · Menu · Order` (Order → Uber Eats).
5. **Footer "Essentials"** — add "Order on Uber Eats".
6. **Menu pages** — "Hungry now? Order on Uber Eats" button at top/bottom of each HTML menu.
7. **Offers page** — flag any delivery-specific deals with the Uber Eats badge.

### Compliance
- Use the **official "Order on Uber Eats" badge/button asset** and brand colours (green/black) per Uber's brand guidelines — don't fake the logo. Link each badge to the correct per-brand store URL.

---

## 6. Bookings page — rules to carry over (verbatim policy)

Both brands share the same booking logic via ResDiary:

- **Online booking for parties up to 8.** Parties of **more than 8** must phone (Asia 0191 607 1100 / Fusion 0191 300 4641).
- **Fri/Sat, 3–5 people:** credit card required. "A fee of £5 per person will be charged in case of a no-show or late cancellation (less than 8 hours before booking time)."
- **6+ people, any day:** "A deposit of £10 per person, the sum paid will be discounted from the final bill. Deposits are not refundable in case of a no-show or late cancellation (less than 8 hours before booking time)."
- All reservations cancelled **20 minutes** after booking time if the guest doesn't make contact about being late.
- **Walk-ins welcome:** "We will try our best to seat you on one of our non-reservable tables."
- "If no times appear … there is no availability for the day/time you have chosen."
- Fusion note: "Lunch Special Served Mon–Fri 12pm–5:30pm. Main Menu served 12pm–10pm (last booking 9:30pm)."

---

## 7. Other page content to carry over

**Gift Vouchers:**
> "Know someone that loves Geisha? Give them the perfect gift with Geisha Gift Vouchers!" — "Available for purchase online or in the restaurant."
*(No denominations or T&Cs currently shown — add these in the rebuild.)*

**Parties & Functions (Fusion VIP Function Room):**
> "Planning a special occasion often involves finding the perfect venue. Our VIP function room is designed to cater for a variety of special occasions, from birthday parties and engagements to baby showers and more."
> Features: cutting-edge sound system (DJ/live music/playlists), versatile lighting, stylish decor, help with decorations & floral arrangements & entertainment.
> Events: birthdays (all ages), engagements, anniversaries, hen parties, bottomless brunch, baby showers/reveals, christenings, graduations, private dining, networking, business meetings, office parties, leaving parties, funeral wakes.
> **Missing today (add these):** capacity numbers, packages, pricing, and an **enquiry form**.

**Contact form fields (both):** Your name (required) · Your email (required) · Subject · Your message.

---

## 8. Brand / visual identity reference (for your reskin)

> Specific brand hex values aren't exposed in the source (most hex in the HTML is WordPress/Gutenberg default junk — ignore those). The palette below is read from the live design. Sample exact values from the logos/screenshots when you build.

**Shared:**
- Brand font: **Panton** (sans, used for body/UI). Display wordmark is a custom angular/oriental-style face — recreate or license.
- Logo: "GEISHA" wordmark + brand sub-label ("ASIA" / "FUSION").
- Social: one shared FB + IG account across both.

**Geisha Asia palette (approx):**
- Background: near-black charcoal `#1c1c1c`–`#222`
- Accent: orange `~#f16521`
- Secondary blocks: teal (mailing list), dusty pink (opening times)
- Imagery: geisha street-art portraits, paper lanterns, dim-sum/sushi flatlays

**Geisha Fusion palette (approx):**
- Background: warm cream `~#f5efd9`
- Blocks: teal (about), terracotta/orange (opening times), deep red (mailing list), blue (footer)
- Wordmark: retro 70s serif
- Imagery: blossom trees, warm lantern interiors, Sunday roast hero shots

---

## 9. Gap analysis — what's missing / should be added or cleaned up

**Clean up (streamline what's there):**
1. Fix copy typos on Fusion homepage ("your're", "server up").
2. Stop linking dated PDF paths (`/2026/04/…_mar26_web.pdf`) — they rot monthly. Use stable URLs.
3. Asia has **no Parties/Functions page** despite having a function space concept — add one (or share Fusion's).
4. Footer "ESSENTIALS" links differ slightly between brands — standardise.
5. No embedded **map** on contact pages — add one.
6. Reduce reliance on PDFs; render menus as HTML (see §4).

**Add (missing features worth having):**
1. **HTML menus** with allergen/dietary filtering (replace PDF-only).
2. **A proper "What's On" / Offers page** so promos (Daytime Special, 2-for-£14, Bottomless Brunch, Sunday Roast) live somewhere permanent, not just a homepage banner.
3. **Parties/functions enquiry form** with date, party size, occasion, budget.
4. **Gift voucher denominations + T&Cs** shown clearly; modern Stripe checkout.
5. **SEO basics:** per-page titles/meta, structured data (`Restaurant`, `Menu`, `OpeningHoursSpecification`), sitemap.
6. **Accessibility & mobile:** PDFs are bad on mobile; HTML menus + proper contrast fix this.
7. **Cookie consent banner** (currently only a policy page).
8. **A unified landing / brand switcher** at the root if you want one entry point that sends visitors to Asia or Fusion.
9. **Reviews / social proof** section (Google rating, testimonials) — currently none.
10. **Careers / "Work with us"** page (common ask for restaurants) — optional.

---

## 10. Final recommended page list for the NEW site (per brand)

| Page | Status | Source feature |
|---|---|---|
| Home | rebuild | §3 |
| Menus (index + per-menu HTML pages) | **new/upgraded** | §4 — replace PDFs |
| Bookings | rebuild | ResDiary, §6 |
| Offers / What's On | **new** | promos in §3.3 |
| Gallery | **new** | §4a — filterable grid + lightbox + IG strip |
| Gift Vouchers | rebuild | Stripe instead of Woo |
| Parties & Functions | rebuild + add Asia | §7 |
| Contact (+ map + form) | rebuild | §7 |
| Order Online (Delivery + Collection) | **upgraded** | Uber Eats (delivery, pushed) + Touch Takeaway (collection) — §5a |
| Privacy & Cookie Policy | keep | — |
| (Optional) Root brand switcher, Reviews, Careers | new | §9 |

**Shared/config-driven data to centralise once:** brand colours & fonts, logo, phone, email, address, opening hours, ResDiary widget ID, menu list, current promo banner, social links. Build a single `brand` config so Asia and Fusion are the *same* site with different data.
