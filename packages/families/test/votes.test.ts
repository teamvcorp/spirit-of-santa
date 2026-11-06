import { test } from "node:test";
import assert from "node:assert/strict";
import { daysSoFar } from "../src/votes.ts";

test("days counted: from Jan 1 or the day the kid was added, today included", () => {
  assert.equal(daysSoFar("2027-01-01", "2026-06-01"), 1); // reset on Jan 1
  assert.equal(daysSoFar("2027-01-10", "2026-06-01"), 10);
  assert.equal(daysSoFar("2027-11-06", "2027-11-06"), 1); // added today
  assert.equal(daysSoFar("2027-11-06", "2027-11-01"), 6);
  assert.equal(daysSoFar("2028-03-01", "2028-02-28"), 3); // leap year: Feb 28, 29, Mar 1
});
