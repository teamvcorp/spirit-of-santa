// No-network tests: error mapping + the development "print instead of send" guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SmsError, sendSms, smsFailureFor } from "../src/index.ts";

test("Twilio error codes → what we tell the visitor", () => {
  assert.equal(smsFailureFor(21610), "optedOut"); // replied STOP earlier
  assert.equal(smsFailureFor(21211), "badNumber");
  assert.equal(smsFailureFor(21614), "badNumber");
  assert.equal(smsFailureFor(30001), "unavailable");
  assert.equal(smsFailureFor(0), "unavailable");
});

test("development prints instead of sending (no network, no credentials)", async () => {
  const r = await sendSms({ to: "+15552345678", body: "test" });
  assert.match(r.sid, /^dev-/);
});

test("refuses a non-E.164 destination before anything else", async () => {
  await assert.rejects(sendSms({ to: "5552345678", body: "x" }), (e: unknown) => e instanceof SmsError && e.code === 21211);
});
