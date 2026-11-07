/**
 * The ONE formula for "do a kid's balances match the points ledger?" (Phase 8, 2026-11-07). Pure: no database.
 * Used by unit tests, E2E scripts and the spend backfill's verify pass, so the rule can't drift between them.
 *
 * How each ledger type moves a kid (see packages/db/src/models/transaction.ts):
 *   earn_*  +available · escrow  available→escrowed · release  escrowed→available · spend  −escrowed (lock)
 *   forfeit −escrowed when it belongs to a gift (Dec 25 close), −available when it doesn't (deletion)
 *   season_reset −available · adjustment_credit/debit ±available
 */
export type LedgerRow = { type: string; amountCentipoints: number; wishListItemId?: unknown };

export type ExpectedBalances = { available: number; escrowed: number };

export function expectedBalances(rows: LedgerRow[]): ExpectedBalances {
  let available = 0;
  let escrowed = 0;
  for (const r of rows) {
    const n = r.amountCentipoints;
    if (r.type.startsWith("earn_") || r.type === "adjustment_credit") available += n;
    else if (r.type === "escrow") {
      available -= n;
      escrowed += n;
    } else if (r.type === "release") {
      escrowed -= n;
      available += n;
    } else if (r.type === "spend") escrowed -= n;
    else if (r.type === "forfeit") {
      if (r.wishListItemId) escrowed -= n;
      else available -= n;
    } else if (r.type === "season_reset" || r.type === "adjustment_debit") available -= n;
    else throw new Error(`unknown ledger type: ${r.type}`);
  }
  return { available, escrowed };
}

/** Escrow a kid SHOULD hold: what its not-yet-locked gifts carry. */
export function expectedEscrow(gifts: { status: string; fundedCentipoints: number }[]): number {
  return gifts.filter((g) => g.status === "active" || g.status === "fully_funded").reduce((n, g) => n + g.fundedCentipoints, 0);
}

/** Every mismatch for one kid (empty = consistent). */
export function ledgerProblems(
  kid: { availableCentipoints: number; escrowedCentipoints: number },
  rows: LedgerRow[],
  gifts: { status: string; fundedCentipoints: number }[],
): string[] {
  const e = expectedBalances(rows);
  const out: string[] = [];
  if (e.available !== kid.availableCentipoints) out.push(`available ${kid.availableCentipoints} != ledger ${e.available}`);
  if (e.escrowed !== kid.escrowedCentipoints) out.push(`escrowed ${kid.escrowedCentipoints} != ledger ${e.escrowed}`);
  const g = expectedEscrow(gifts);
  if (g !== kid.escrowedCentipoints) out.push(`escrowed ${kid.escrowedCentipoints} != open gifts ${g}`);
  if (e.available < 0 || e.escrowed < 0) out.push("ledger goes negative");
  return out;
}
