import { test } from "node:test";
import assert from "node:assert/strict";
import { CAP_STATUSES, countsTowardCap, isRemovable, lockAt } from "../src/rules.ts";

const DAY = 86_400_000;
const now = new Date("2026-11-20T12:00:00Z");

test("lockAt is 30 days after full funding, null when not funded", () => {
  assert.equal(lockAt(null), null);
  assert.equal(lockAt(new Date("2026-11-01T00:00:00Z"))?.toISOString(), "2026-12-01T00:00:00.000Z");
});

test("active items are always removable", () => {
  assert.equal(isRemovable("active", null, now), true);
});

test("fully funded items are removable only before the lock date", () => {
  assert.equal(isRemovable("fully_funded", new Date(now.getTime() - 29 * DAY), now), true);
  assert.equal(isRemovable("fully_funded", new Date(now.getTime() - 30 * DAY), now), false); // exactly 30 days = locked
  assert.equal(isRemovable("fully_funded", new Date(now.getTime() - 31 * DAY), now), false);
});

test("locked, shipped, delivered, removed and unfunded items are never removable", () => {
  for (const s of ["locked", "shipped", "delivered", "removed", "unfunded"]) assert.equal(isRemovable(s, null, now), false, s);
});

test("unfunded and removed don't count toward the cap", () => {
  assert.equal(countsTowardCap("removed"), false);
  assert.equal(countsTowardCap("unfunded"), false);
  for (const s of CAP_STATUSES) assert.equal(countsTowardCap(s), true, s);
});
