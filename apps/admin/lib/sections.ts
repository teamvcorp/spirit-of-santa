/**
 * The admin sections, in nav order (Phase 8.5.3). A plain module (no "use client") so BOTH the
 * server gate (labels) and the client nav (links) can use it: a value exported from a "use client"
 * file reaches server code only as a client reference, not as data (found by a screenshot check).
 */
export const ADMIN_SECTIONS = ["stores", "season", "users", "deeds", "moderation", "donations", "fulfilment", "payouts", "settings"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];
