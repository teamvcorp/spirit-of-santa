import { test } from "node:test";
import assert from "node:assert/strict";
import { daysSoFar } from "../src/votes.ts";

test("days on the current list: from Dec 26 (list start) or registration, today included", () => {
  assert.equal(daysSoFar("2026-12-26", "2026-06-01"), 1); // a new list starts the day after Christmas
  assert.equal(daysSoFar("2027-01-01", "2026-06-01"), 7); // Dec 26..Jan 1
  assert.equal(daysSoFar("2027-11-06", "2027-11-06"), 1); // registered today
  assert.equal(daysSoFar("2027-11-06", "2027-11-01"), 6);
  assert.equal(daysSoFar("2028-03-01", "2028-02-28"), 3); // leap year: Feb 28, 29, Mar 1
  assert.equal(daysSoFar("2026-12-25", "2025-12-26"), 365); // a whole list: Dec 26 2025 .. Dec 25 2026
});
