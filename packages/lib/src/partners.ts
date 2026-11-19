/**
 * Public partners page rules, pure (owner 2026-11-18; data in @repo/stores/partners).
 *
 * Store status → what the public sees. Stores WE rejected or suspended are not listed (null).
 * Order: approved, processing, pending, declined; A→Z inside each group. The Christmas Magic donor star is
 * recognition only and must NEVER change the order (hard rule, tested in test/partners.test.ts).
 */
export const PARTNER_STATUSES = ["approved", "processing", "pending", "declined"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** Store statuses that appear on the page (the database filter uses this list). */
export const LISTED_STORE_STATUSES = ["invited", "pending", "approved", "declined"] as const;
const PUBLIC_STATUS: Record<(typeof LISTED_STORE_STATUSES)[number], PartnerStatus> = {
  invited: "pending",
  pending: "processing",
  approved: "approved",
  declined: "declined",
};

export function publicPartnerStatus(storeStatus: string): PartnerStatus | null {
  return (LISTED_STORE_STATUSES as readonly string[]).includes(storeStatus) ? PUBLIC_STATUS[storeStatus as (typeof LISTED_STORE_STATUSES)[number]] : null;
}

/** Sorted copy: status group, then name (case-insensitive, then exact, so the order is always the same). */
export function orderPartners<T extends { status: PartnerStatus; name: string }>(rows: readonly T[]): T[] {
  const rank = (s: PartnerStatus) => PARTNER_STATUSES.indexOf(s);
  return [...rows].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
