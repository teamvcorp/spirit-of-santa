/**
 * Family rules shared by server and UI. CLIENT-SAFE.
 */

/**
 * Version of the parental consent text + Children's Privacy Notice a parent agrees to at sign-up
 * (family app /register and /privacy). Bump whenever that wording changes; each Family records
 * the version it accepted. "-draft": the wording is a DRAFT until a lawyer reviews it (COPPA).
 */
export const PARENT_CONSENT_VERSION = "2026-11-06-draft"; // + text-message & visitor sections

/** Terms of Service version shown on /terms (bump with any change). */
export const TERMS_VERSION = "2026-11-06-draft";

/** Version of the pay-later text consent wording (registered with carriers); stored with each consent. */
export const SMS_CONSENT_VERSION = "sms-2026-11-06";

/** Daily Naughty/Nice vote values: ONE list for the model, the form schema and the service. */
export const KID_VOTES = ["nice", "naughty"] as const;
export type KidVoteValue = (typeof KID_VOTES)[number];
