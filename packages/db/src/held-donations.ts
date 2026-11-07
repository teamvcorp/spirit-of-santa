/**
 * THE rule for a held community gift (/donate) that may be shared (split) or retained (season end): paid,
 * still held, never refunded, not disputed, not flagged. Anything else stays held for an admin.
 *
 * Lives in @repo/db (not @repo/payments) so BOTH the split / season end (@repo/payments) AND the pay-up
 * window (@repo/wishlists, which @repo/payments imports) use the same filter without an import cycle.
 * Re-exported from @repo/payments/split for older callers.
 */
import { trusted } from "./connect.ts";

export const cleanHeldDonations = (seasonYear: number) => ({
  purpose: "donation" as const,
  status: "succeeded" as const,
  fulfilment: "held" as const,
  seasonYear,
  refundedCents: 0,
  "dispute.stripeDisputeId": null,
  needsReview: trusted({ $ne: true }),
});
