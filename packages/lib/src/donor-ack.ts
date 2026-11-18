/**
 * DONOR ACKNOWLEDGMENT (owner 2026-11-18, docs/plans/founding-partners.md slice 4).
 *
 * Before any donation is paid, the donor ticks a box saying what the gift is for and that they get nothing in
 * return (the wording lives in apps/family/messages Community.ack, EN + ES). We record WHICH wording they saw
 * (this version) on the Payment, the same pattern as PARENT_CONSENT_VERSION / SMS_CONSENT_VERSION.
 *
 * NEVER reuse a version string: bump it whenever the text changes (old payments keep the version they saw).
 *
 * Receipts: a donation receipt needs a recorded acknowledgment. Gifts paid BEFORE this shipped have none and keep
 * the old behaviour (they still get their receipt): DONOR_ACK_REQUIRED_FROM is a day comfortably after the
 * release, so a checkout opened just before the release (open for up to 23.5 h) still gets its receipt.
 */
import { startOfDayInZone } from "./season.ts";

/** History: "donor-ack-2026-11-18" = first wording (approved by the owner 2026-11-18). */
export const DONOR_ACK_VERSION = "donor-ack-2026-11-18";

/** Stripe metadata / form value shape for any version (old versions must still parse in the webhook). */
export const DONOR_ACK_VERSION_PATTERN = /^donor-ack-\d{4}-\d{2}-\d{2}[a-z]?$/;

/** Central-Time calendar day from which a donation receipt REQUIRES the acknowledgment. */
export const DONOR_ACK_REQUIRED_FROM = "2026-11-20";

/**
 * May this donation get a receipt, as far as the acknowledgment goes?
 * Yes when the donor's acknowledgment was recorded, or the gift is older than the rule.
 */
export function ackAllowsReceipt(gift: { donorAck?: { version?: string | null } | null; donatedAt: Date }): boolean {
  if (gift.donorAck?.version && DONOR_ACK_VERSION_PATTERN.test(gift.donorAck.version)) return true;
  return gift.donatedAt.getTime() < startOfDayInZone(DONOR_ACK_REQUIRED_FROM).getTime();
}
