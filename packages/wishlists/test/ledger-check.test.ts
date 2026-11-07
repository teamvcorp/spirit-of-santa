import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedBalances, expectedEscrow, ledgerProblems } from "../src/ledger-check.ts";

const g = "gift1";

test("escrow then spend at lock: the magic leaves escrow for good (never counted twice)", () => {
  const rows = [
    { type: "earn_tip", amountCentipoints: 3000 },
    { type: "escrow", amountCentipoints: 2000, wishListItemId: g },
    { type: "spend", amountCentipoints: 2000, wishListItemId: g },
  ];
  assert.deepEqual(expectedBalances(rows), { available: 1000, escrowed: 0 });
});

test("release returns escrow to available; Dec 25 forfeit of a gift lowers escrow", () => {
  assert.deepEqual(
    expectedBalances([
      { type: "earn_donation", amountCentipoints: 1000 },
      { type: "escrow", amountCentipoints: 1000, wishListItemId: g },
      { type: "release", amountCentipoints: 400, wishListItemId: g },
      { type: "forfeit", amountCentipoints: 600, wishListItemId: g },
    ]),
    { available: 400, escrowed: 0 },
  );
});

test("deletion forfeit (no gift) and the Jan 1 reset lower available; adjustments both ways", () => {
  assert.deepEqual(
    expectedBalances([
      { type: "earn_bonus", amountCentipoints: 1000 },
      { type: "adjustment_credit", amountCentipoints: 50 },
      { type: "adjustment_debit", amountCentipoints: 20 },
      { type: "season_reset", amountCentipoints: 30 },
      { type: "forfeit", amountCentipoints: 1000 },
    ]),
    { available: 0, escrowed: 0 },
  );
});

test("the OLD bug is caught: a locked gift with no spend leaves escrow above what open gifts hold", () => {
  const kid = { availableCentipoints: 0, escrowedCentipoints: 2000 };
  const rows = [
    { type: "earn_tip", amountCentipoints: 2000 },
    { type: "escrow", amountCentipoints: 2000, wishListItemId: g },
  ];
  const problems = ledgerProblems(kid, rows, [{ status: "locked", fundedCentipoints: 2000 }]);
  assert.ok(problems.some((p) => p.includes("open gifts 0")), problems.join("; "));
});

test("consistent kid → no problems; a spend with no escrow → negative, flagged", () => {
  const rows = [
    { type: "earn_tip", amountCentipoints: 500 },
    { type: "escrow", amountCentipoints: 300, wishListItemId: g },
  ];
  assert.deepEqual(ledgerProblems({ availableCentipoints: 200, escrowedCentipoints: 300 }, rows, [{ status: "active", fundedCentipoints: 300 }]), []);
  assert.ok(ledgerProblems({ availableCentipoints: 0, escrowedCentipoints: 0 }, [{ type: "spend", amountCentipoints: 100 }], []).includes("ledger goes negative"));
  assert.equal(expectedEscrow([{ status: "fully_funded", fundedCentipoints: 5 }, { status: "shipped", fundedCentipoints: 9 }]), 5);
});

test("an unknown ledger type is an error, never silently ignored", () => {
  assert.throws(() => expectedBalances([{ type: "mystery", amountCentipoints: 1 }]));
});
