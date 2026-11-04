/**
 * Business limits from SpiritOfSanta.md. CLIENT-SAFE (the UI needs them for hints and
 * form validation), but the SERVER must enforce every one of them again; client checks are
 * only for UX.
 */

/** Max items a store may list per season. */
export const STORE_ITEM_LIMIT = 50;

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
