/**
 * Ready-made thank-you notes (owner 2026-11-07). CLIENT-SAFE.
 *
 * Someone who scans a child's good-deed QR code but can't give money right now can say thank you with one of
 * these notes. Ready-made on purpose ("a generic thank-you note"): a stranger never sends a child their own words
 * (no names, contact details or anything unkind can reach a minor), and the parent approves each note with one
 * click before the child sees it. The text lives in the messages (Qr.notes.<key>, both languages); only the KEY
 * is stored on the deed, so the child sees the note in the family's own language.
 */
export const THANK_NOTES = ["thankYou", "madeMyDay", "soKind", "merryChristmas"] as const;
export type ThankNote = (typeof THANK_NOTES)[number];

export const isThankNote = (v: unknown): v is ThankNote => typeof v === "string" && (THANK_NOTES as readonly string[]).includes(v);
