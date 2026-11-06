import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TOTALS, FUNDED_STATUSES, fundingPercent, LOCKED_STATUSES, ON_LIST_STATUSES, sumTotals } from "../src/engagement-math.ts";
import { WISH_LIST_STATUSES } from "../../db/src/models/wish-list-item.ts";

test("funding %: integer, rounded DOWN, 0 when nothing listed", () => {
  assert.equal(fundingPercent(EMPTY_TOTALS), 0);
  assert.equal(fundingPercent({ fundedCentipoints: 0, costCentipoints: 2999 }), 0);
  assert.equal(fundingPercent({ fundedCentipoints: 1500, costCentipoints: 3000 }), 50);
  // 99.97% must not show as 100% before every list is fully funded.
  assert.equal(fundingPercent({ fundedCentipoints: 2998, costCentipoints: 2999 }), 99);
  assert.equal(fundingPercent({ fundedCentipoints: 2999, costCentipoints: 2999 }), 100);
  // Defensive: bad data never shows more than 100%.
  assert.equal(fundingPercent({ fundedCentipoints: 5000, costCentipoints: 2999 }), 100);
});

test("store summary adds every item's totals", () => {
  const a = { onLists: 3, fullyFunded: 1, locked: 1, fundedCentipoints: 4000, costCentipoints: 9000 };
  const b = { onLists: 2, fullyFunded: 2, locked: 0, fundedCentipoints: 2000, costCentipoints: 2000 };
  assert.deepEqual(sumTotals([a, b]), { onLists: 5, fullyFunded: 3, locked: 1, fundedCentipoints: 6000, costCentipoints: 11000 });
  assert.deepEqual(sumTotals([]), EMPTY_TOTALS);
});

test("status groups: removed never counts; locked ⊂ funded ⊂ on list; all are real statuses", () => {
  const real = new Set<string>(WISH_LIST_STATUSES);
  for (const s of [...ON_LIST_STATUSES, ...FUNDED_STATUSES, ...LOCKED_STATUSES]) assert.ok(real.has(s), s);
  assert.ok(!(ON_LIST_STATUSES as readonly string[]).includes("removed"));
  for (const s of FUNDED_STATUSES) assert.ok((ON_LIST_STATUSES as readonly string[]).includes(s), s);
  for (const s of LOCKED_STATUSES) assert.ok((FUNDED_STATUSES as readonly string[]).includes(s), s);
  // Every status except "removed" is classified, so a new status can't silently vanish.
  assert.deepEqual([...real].filter((s) => s !== "removed").sort(), [...ON_LIST_STATUSES].sort());
});
