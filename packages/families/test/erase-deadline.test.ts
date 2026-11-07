import { test } from "node:test";
import assert from "node:assert/strict";
import { deletionDeadline } from "../src/erase.ts";

// "Deliver, then delete" (year-round, owner 2026-11-07): contact + address are kept until the gifts are delivered,
// at the latest the END of Jan 31 (Chicago time) after the Christmas of the newest gift on its way.

test("deadline = end of Jan 31 Chicago time after that gift's Christmas", () => {
  // 2027 gifts (held since e.g. March 2027) → Jan 31 2028 23:59:59.999 CST = Feb 1 2028 05:59:59.999 UTC.
  assert.equal(deletionDeadline(2027).toISOString(), "2028-02-01T05:59:59.999Z");
  assert.equal(deletionDeadline(2026).toISOString(), "2027-02-01T05:59:59.999Z");
});

test("not the UTC day: Jan 31 evening in Chicago is still before the deadline", () => {
  const d = deletionDeadline(2027).getTime();
  assert.ok(new Date("2028-02-01T03:00:00Z").getTime() < d); // 9 pm Jan 31 CST
  assert.ok(new Date("2028-02-01T06:00:00Z").getTime() > d); // midnight Feb 1 CST
});
