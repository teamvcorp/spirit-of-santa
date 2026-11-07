/**
 * What to do when a per-gift money step fails in a daily job (lock + spend, Dec 25 close). Phase 8, 2026-11-07.
 *
 * Teaching note — three very different failures, three different answers:
 *  - "data"      the RECORDS are wrong (kid missing, escrow too low, amounts don't add up, a ledger key that
 *                already exists). Retrying won't help → PARK the gift for a human (and alert).
 *  - "changed"   someone else changed the gift first (the parent removed it, a deletion, a second cron run).
 *                Nothing is wrong → SKIP it, no alert.
 *  - "transient" the database was briefly unreachable (failover, timeout). The records are fine → STOP this
 *                run and let tomorrow's run continue. Parking here would freeze healthy gifts for good.
 * Money is never half-written in any case: each step is one transaction.
 */

/** The records themselves are inconsistent (never fixed by retrying). */
export class LedgerDataError extends Error {
  override name = "LedgerDataError";
}

/** The row changed under us (a concurrent, legitimate change). */
export class RowChangedError extends Error {
  override name = "RowChangedError";
}

export type FailureKind = "data" | "changed" | "transient";

export function classifyFailure(err: unknown): FailureKind {
  if (err instanceof LedgerDataError) return "data";
  if (err instanceof RowChangedError) return "changed";
  // A duplicate unique key (e.g. "spend:<id>" already booked) means the ledger disagrees with the gift's status.
  if ((err as { code?: number } | null)?.code === 11000) return "data";
  return "transient";
}
