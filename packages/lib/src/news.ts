/**
 * News emails (owner 2026-11-12): opted-in ADULTS get Spirit of Santa news broadcasts, sent from the Resend
 * dashboard. CLIENT-SAFE (no secrets): shared by the forms and the server.
 */

/**
 * Version of the opt-in wording people tick ("News.optIn" in the family messages). Stored on every
 * NewsSubscription as proof of what they agreed to. NEVER reuse a version string: bump it whenever that
 * wording changes (both languages).
 */
export const NEWS_CONSENT_VERSION = "2026-11-12";

/** After this many failed Resend tries the daily job stops retrying a row and reports it (a human looks). */
export const NEWS_MAX_SYNC_ATTEMPTS = 10;
