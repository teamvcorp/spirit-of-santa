import { test } from "node:test";
import assert from "node:assert/strict";
import { deletionDeadline } from "../src/erase.ts";

// "Deliver, then delete": contact + address are kept at most 45 days and NEVER past Jan 31 (owner rule).
const at = (iso: string) => new Date(iso);
const JAN31 = (y: number) => new Date(Date.UTC(y, 0, 31, 23, 59, 59)).toISOString();

test("45 days when that is before Jan 31", () => {
  assert.equal(deletionDeadline(at("2026-11-07T12:00:00Z")).toISOString(), "2026-12-22T12:00:00.000Z");
  assert.equal(deletionDeadline(at("2027-02-10T00:00:00Z")).toISOString(), "2027-03-27T00:00:00.000Z");
});

test("Jan 31 is a hard cap (never later, even very close to it)", () => {
  assert.equal(deletionDeadline(at("2026-12-20T12:00:00Z")).toISOString(), JAN31(2027));
  assert.equal(deletionDeadline(at("2027-01-25T12:00:00Z")).toISOString(), JAN31(2027));
  assert.equal(deletionDeadline(at("2027-01-31T20:00:00Z")).toISOString(), JAN31(2027));
});
