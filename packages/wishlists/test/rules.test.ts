import { test } from "node:test";
import assert from "node:assert/strict";
import { CAP_STATUSES, countsTowardCap, isRemovable, maskSurprise } from "../src/rules.ts";

test("only gifts still collecting magic are removable (fully funded = secured, owner 2026-11-07)", () => {
  assert.equal(isRemovable("active"), true);
  for (const s of ["fully_funded", "locked", "shipped", "delivered", "removed", "unfunded"]) assert.equal(isRemovable(s), false, s);
});

test("unfunded and removed don't count toward the cap", () => {
  assert.equal(countsTowardCap("removed"), false);
  assert.equal(countsTowardCap("unfunded"), false);
  for (const s of CAP_STATUSES) assert.equal(countsTowardCap(s), true, s);
});

test("a surprise row loses everything that would give it away; other rows are untouched", () => {
  const row = { id: "w1", surprise: true, itemId: "i1", name: "Red bike", storeName: "Bike Shop", photoUrl: "https://x/p.jpg" as string | undefined, viewable: true, costCentipoints: 2000, fundedCentipoints: 500 };
  const masked = maskSurprise(row);
  assert.deepEqual(masked, { ...row, itemId: "", name: "", storeName: "", photoUrl: undefined, viewable: false });
  assert.ok(!JSON.stringify(masked).includes("Red bike") && !JSON.stringify(masked).includes("p.jpg"));
  assert.equal(masked.fundedCentipoints, 500, "progress stays visible");
  const normal = { ...row, surprise: false };
  assert.equal(maskSurprise(normal), normal);
});
