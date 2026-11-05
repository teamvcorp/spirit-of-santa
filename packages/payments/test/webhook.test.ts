// No-database tests: metadata contract, signature verification, routing of no-op events.
// The database side is covered end-to-end by scripts/e2e/stripe-webhook.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { buildPaymentMetadata, parsePaymentMetadata } from "../src/metadata.ts";
import { expectedLivemode } from "../src/client.ts";
import { dispatchStripeEvent, verifyStripeEvent } from "../src/webhook.ts";

const KID = "0123456789abcdef01234567";
const FAM = "fedcba9876543210fedcba98";
const SECRET = "whsec_test_" + "x".repeat(32);

test("metadata: build → parse round trip, versioned and sos_-prefixed", () => {
  const md = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: KID, sos_family_id: FAM });
  assert.deepEqual(md, { sos_v: "1", sos_purpose: "tip", sos_kid_id: KID, sos_family_id: FAM });
  assert.deepEqual(parsePaymentMetadata(md), md);
  assert.throws(() => buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: "nope", sos_family_id: FAM }));
});

test("metadata: anything that isn't exactly our format is 'not ours'", () => {
  for (const md of [
    null,
    {},
    { sos_purpose: "tip", sos_kid_id: KID, sos_family_id: FAM }, // missing version
    { sos_v: "2", sos_purpose: "tip", sos_kid_id: KID, sos_family_id: FAM }, // future version
    { sos_v: "1", sos_purpose: "gift", sos_kid_id: KID, sos_family_id: FAM }, // unknown purpose
    { sos_v: "1", sos_purpose: "tip", sos_kid_id: '{"$ne":null}', sos_family_id: FAM }, // injection-shaped id
    { sos_v: "1", sos_purpose: "payup", sos_kid_id: KID, sos_family_id: FAM }, // payup needs an item
  ]) {
    assert.equal(parsePaymentMetadata(md as Record<string, string> | null), null, JSON.stringify(md));
  }
  // Extra keys from elsewhere are dropped, not trusted.
  const parsed = parsePaymentMetadata({ sos_v: "1", sos_purpose: "bonus", sos_kid_id: KID, sos_family_id: FAM, admin: "true" });
  assert.equal(parsed && "admin" in parsed, false);
});

function signed(payload: object, opts: { secret?: string; timestamp?: number } = {}) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: opts.secret ?? SECRET,
    timestamp: opts.timestamp,
  });
  return { body, header };
}
const fakeEvent = { id: "evt_test123", object: "event", type: "checkout.session.expired", livemode: false, data: { object: { id: "cs_test_1" } } };

test("signature: valid passes; wrong secret, tampered body, stale or missing header fail", () => {
  const ok = signed(fakeEvent);
  assert.equal(verifyStripeEvent(ok.body, ok.header, SECRET).id, "evt_test123");

  const wrongSecret = signed(fakeEvent, { secret: "whsec_other_" + "y".repeat(32) });
  assert.throws(() => verifyStripeEvent(wrongSecret.body, wrongSecret.header, SECRET));

  assert.throws(() => verifyStripeEvent(ok.body.replace("expired", "completed"), ok.header, SECRET), "tampered body");

  const stale = signed(fakeEvent, { timestamp: Math.floor(Date.now() / 1000) - 600 }); // 10 min old
  assert.throws(() => verifyStripeEvent(stale.body, stale.header, SECRET), "replay window is 5 min");

  assert.throws(() => verifyStripeEvent(ok.body, "t=1,v1=deadbeef", SECRET));
  // JSON re-serialisation changes bytes → must fail (why we read the RAW body).
  const reformatted = JSON.stringify(JSON.parse(ok.body), null, 2);
  assert.throws(() => verifyStripeEvent(reformatted, ok.header, SECRET));
});

test("livemode comes from the key type; unknown keys are refused", () => {
  assert.equal(expectedLivemode("sk_live_abc"), true);
  assert.equal(expectedLivemode("rk_live_abc"), true);
  assert.equal(expectedLivemode("sk_test_abc"), false);
  assert.throws(() => expectedLivemode("pk_test_abc")); // publishable key is not a secret key
  assert.throws(() => expectedLivemode(undefined));
});

test("events that need no action are acknowledged without touching the database", async () => {
  const ev = (type: string) => ({ ...fakeEvent, type }) as unknown as Stripe.Event;
  assert.deepEqual(await dispatchStripeEvent(ev("checkout.session.expired")), { status: "ignored", note: "no_action_needed" });
  assert.deepEqual(await dispatchStripeEvent(ev("customer.created")), { status: "ignored", note: "unsubscribed_event_type" });
});
