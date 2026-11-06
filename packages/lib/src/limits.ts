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

/** Kids per family (a sanity cap: also bounds the $5 registrations one card pays for). */
export const MAX_KIDS_PER_FAMILY = 10;
/** Kids are under 18: birth year between (this year - 17) and this year. */
export const MAX_KID_AGE_YEARS = 17;

/** A fully funded item locks (can't be removed) after this many days on the list. */
export const ITEM_LOCK_DAYS = 30;

/** Twilio pay-later SMS links expire after this many days. */
export const PAY_LATER_LINK_DAYS = 7;

/** Tip buttons on the community QR page ($5 / $10 / $25; "Other" is free entry). */
export const TIP_PRESETS_CENTS = [500, 1000, 2500] as const;

/**
 * Bounds for a free-entry tip. Stripe's USD minimum is $0.50.
 * The max is a fraud / fat-finger guard. ASSUMPTION: $1,000; adjust in admin later if needed.
 */
export const MIN_TIP_CENTS = 100;
export const MAX_TIP_CENTS = 100_000;

/** Send the "full funding needed" push when an item reaches this funding percentage. */
export const FULL_FUNDING_ALERT_PERCENT = 90;
