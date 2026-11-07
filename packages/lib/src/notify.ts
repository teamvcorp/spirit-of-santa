/**
 * Parent email notification kinds (Phase 7): client-safe, so the settings FORM and the server
 * share ONE list (a kind missing from the form would be switched off on every save).
 */
export const NOTIFY_KINDS = ["magic", "deeds", "reminders"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type NotifyPrefs = Record<NotifyKind, boolean>;
