import { test } from "node:test";
import assert from "node:assert/strict";
import { CAP_STATUSES, countsTowardCap, isRemovable } from "../src/rules.ts";

test("only gifts still collecting magic are removable (fully funded = secured, owner 2026-11-07)", () => {
  assert.equal(isRemovable("active"), true);
  for (const s of ["fully_funded", "locked", "shipped", "delivered", "removed", "unfunded"]) assert.equal(isRemovable(s), false, s);
});

test("unfunded and removed don't count toward the cap", () => {
  assert.equal(countsTowardCap("removed"), false);
  assert.equal(countsTowardCap("unfunded"), false);
  for (const s of CAP_STATUSES) assert.equal(countsTowardCap(s), true, s);
});
