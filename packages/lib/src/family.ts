/**
 * Family rules shared by server and UI. CLIENT-SAFE.
 */

/**
 * Version of the parental consent text + Children's Privacy Notice a parent agrees to at sign-up
 * (family app /register and /privacy). Bump whenever that wording changes; each Family records
 * the version it accepted. The owner removed the public "DRAFT" labels on 2026-11-07; the lawyer review is still
 * open (docs/legal/lawyer-packet.md): any wording it changes gets a NEW version (and the re-consent step first).
 */
// NEVER reuse a version string: a family's stored consent.version must identify ONE exact wording.
// History: 2026-11-05-draft (first) · 2026-11-06-draft (+ text-message & visitor sections, fd24a91) ·
// 2026-11-06b-draft (+ delivery address, missed at Phase 6 slice 4b, + "Christmas Magic" wording).
// 2026-11-07-draft ("deliver, then delete": what is kept for delivery when an account is deleted).
// 2026-11-07b-draft (year-round season: gifts held to December, so delivery data kept until Jan 31 after that Christmas).
// 2026-11-07c (DRAFT label removed by the owner; ready-made thank-you notes the parent approves). NOTE: the Spanish
// audit fixes landed while the version still read 2026-11-07b-draft, so families stored with 07b-draft may have seen
// the pre-audit Spanish text (no real families existed then).
// Families that accepted an older version keep that record (re-consent: Phase 8).
export const PARENT_CONSENT_VERSION = "2026-11-07c";

/**
 * Version of the WHOLE /privacy page (bump with any change). Separate from PARENT_CONSENT_VERSION
 * (what parents agreed to about their children): the visitor + text-message sections added
 * 2026-11-06 don't change anything parents agreed to (review 2026-11-06).
 */
// c (2026-11-07): "deliver, then delete" retention when an account is deleted with a paid gift on its way.
// d (2026-11-07b): year-round season (delivery data kept until Jan 31 after that Christmas).
// e (2026-11-07c): DRAFT label removed (owner); Spanish audit fixes; thank-you notes (public section).
export const PRIVACY_VERSION = "2026-11-07c";

/** Terms of Service version shown on /terms (bump with any change). */
export const TERMS_VERSION = "2026-11-07b"; // 2026-11-06b: "Christmas Magic" · 2026-11-07: season section · 2026-11-07b: DRAFT label removed, Spanish fixes

/**
 * Pay-later text consent (registered with the carriers, docs/vendor/twilio.md). Stored with each
 * consent record (slice 4b). SMS_CONSENT_SHA256 pins the exact wording per language (first 16 hex
 * of SHA-256 of messages PayLater.consent): the i18n test FAILS if the wording changes without a
 * new version + hash (and the carriers must be told about new wording).
 */
// Bumped 2026-11-06b: brand renamed "Spirit O Santa" → "Spirit of Santa" in the consent text (carriers told).
export const SMS_CONSENT_VERSION = "sms-2026-11-06b";
export const SMS_CONSENT_SHA256: Record<"en" | "es", string> = { en: "8e1214175ce66a11", es: "c834cdd8acee6f31" };

/** Daily Naughty/Nice vote values: ONE list for the model, the form schema and the service. */
export const KID_VOTES = ["nice", "naughty"] as const;
export type KidVoteValue = (typeof KID_VOTES)[number];
