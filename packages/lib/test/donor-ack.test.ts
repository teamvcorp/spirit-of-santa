import { test } from "node:test";
import assert from "node:assert/strict";
import { ackAllowsReceipt, DONOR_ACK_VERSION, DONOR_ACK_VERSION_PATTERN } from "../src/donor-ack.ts";

test("the current version matches the pattern the webhook accepts", () => {
  assert.ok(DONOR_ACK_VERSION_PATTERN.test(DONOR_ACK_VERSION));
  assert.ok(!DONOR_ACK_VERSION_PATTERN.test("yes"));
});

test("ackAllowsReceipt: recorded ack → yes; none → only for gifts before the rule day (Central Time)", () => {
  const after = new Date("2026-12-01T18:00:00Z");
  assert.equal(ackAllowsReceipt({ donorAck: { version: DONOR_ACK_VERSION }, donatedAt: after }), true);
  assert.equal(ackAllowsReceipt({ donatedAt: after }), false);
  assert.equal(ackAllowsReceipt({ donorAck: { version: "nonsense" }, donatedAt: after }), false);
  assert.equal(ackAllowsReceipt({ donatedAt: new Date("2026-11-10T18:00:00Z") }), true);
  // 2026-11-20 00:30 UTC is still Nov 19 in Chicago: allowed. 06:30 UTC is Nov 20: needs the ack.
  assert.equal(ackAllowsReceipt({ donatedAt: new Date("2026-11-20T00:30:00Z") }), true);
  assert.equal(ackAllowsReceipt({ donatedAt: new Date("2026-11-20T06:30:00Z") }), false);
});
