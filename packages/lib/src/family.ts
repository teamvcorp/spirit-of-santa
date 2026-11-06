/**
 * Family rules shared by server and UI. CLIENT-SAFE.
 */

/**
 * Version of the parental consent text + Children's Privacy Notice a parent agrees to at sign-up
 * (family app /register and /privacy). Bump whenever that wording changes; each Family records
 * the version it accepted. "-draft": the wording is a DRAFT until a lawyer reviews it (COPPA).
 */
export const PARENT_CONSENT_VERSION = "2026-11-05-draft";
