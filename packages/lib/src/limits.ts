/**
 * Business limits from SpiritOfSanta.md. CLIENT-SAFE (the UI needs them for hints and
 * form validation), but the SERVER must enforce every one of them again; client checks are
 * only for UX.
 */

/** Max items a store may list per season. */
export const STORE_ITEM_LIMIT = 50;

/**
 * Per-child registration fee ($5, in cents): the card payment that verifies parental consent
 * (COPPA, user decision 2026-11-05). Platform revenue, not points. With the family promo code the
 * family pays it once (first child) and further children are free.
 */
export const REGISTRATION_FEE_CENTS = 500;

/** A deed's QR code works for this many days (single use). */
export const DEED_QR_DAYS = 14;
/** Deeds one child can record per day (abuse cap). */
export const MAX_DEEDS_PER_KID_PER_DAY = 10;

/** Kids per family (a sanity cap: also bounds the $5 registrations one card pays for). */
export const MAX_KIDS_PER_FAMILY = 10;
/** Kids are under 18: birth year between (this year - 17) and this year. */
export const MAX_KID_AGE_YEARS = 17;

/**
 * A replacement for an admin-hidden item (added any time of year) stays editable by the OWNER for this many days
 * after it is created, so a photo can be added and mistakes fixed outside Jan 1 - Mar 31 (review 2026-11-07).
 */
export const REPLACEMENT_EDIT_DAYS = 14;

/** Adding a wish-list item needs at least this many AVAILABLE centipoints (1 point; roadmap). */
export const MIN_CENTIPOINTS_TO_ADD_ITEM = 100;

/**
 * Pay-up (owner 2026-11-07, year-round season): giving closes at the freeze date (Dec 1); then, right after the
 * community donations are shared out, parents have this many days (Dec 1-3) to pay what a gift still misses.
 * Gifts still unfinished after that drop off. Counted from the freeze date, so admin-set dates work.
 */
export const PAY_UP_DAYS = 3;

/** Stripe's smallest card charge (USD). A pay-up below it is charged this; extra points go to the kid. */
export const MIN_STRIPE_CHARGE_CENTS = 50;

/**
 * Twilio pay-later SMS links expire after this many days. REGISTERED with the carriers as "7 days" in the
 * consent wording (messages PayLater.consent, docs/vendor/twilio.md): changing it means re-registering.
 */
export const PAY_LATER_LINK_DAYS = 7;

/** Tip buttons on the community QR page ($5 / $10 / $25; "Other" is free entry). */
export const TIP_PRESETS_CENTS = [500, 1000, 2500] as const;

/**
 * Bounds for a free-entry tip. Stripe's USD minimum is $0.50.
 * The max is a fraud / fat-finger guard. ASSUMPTION: $1,000; adjust in admin later if needed.
 */
export const MIN_TIP_CENTS = 100;
export const MAX_TIP_CENTS = 100_000;

/**
 * Community donations (/donate, Phase 5 slice 2): preset buttons and free-entry bounds. Bigger
 * than tips (businesses give). ASSUMPTION: $5–$50,000 (fat-finger/fraud guard); larger gifts can
 * be arranged with an admin. The webhook re-checks the same bounds.
 */
export const DONATION_PRESETS_CENTS = [2500, 5000, 10_000, 25_000] as const;
export const MIN_DONATION_CENTS = 500;
export const MAX_DONATION_CENTS = 5_000_000;
/** Highest platform fee an admin can set on donation pools (basis points: 3000 = 30%). */
export const MAX_DONATION_FEE_BPS = 3000;

/**
 * Stripe Checkout lifetime bounds (expires_at): at least 30 minutes (we use 31 so a session about
 * to expire is refused) and strictly under 24 hours (we use 23.5). Shared by tips, donations, bonus.
 */
export const MIN_CHECKOUT_MS = 31 * 60_000;
export const MAX_CHECKOUT_MS = 23.5 * 3_600_000;

/** Send the "full funding needed" push when an item reaches this funding percentage. */
export const FULL_FUNDING_ALERT_PERCENT = 90;
