import { test } from "node:test";
import assert from "node:assert/strict";

// Test-only secret (never a real one); set BEFORE the module reads it.
process.env.NEXTAUTH_SECRET = "test-secret-for-unsubscribe-tokens-only-0123456789";
const { prefsOf, readUnsubscribeToken, unsubscribeToken } = await import("../src/notifications.ts");

const FID = "65f0c0ffee0000000000abcd";

test("missing preferences mean ON; only an explicit false is OFF", () => {
  assert.deepEqual(prefsOf(undefined), { magic: true, deeds: true, reminders: true });
  assert.deepEqual(prefsOf({ magic: false, deeds: null }), { magic: false, deeds: true, reminders: true });
});

test("a token round-trips to its family and kind", () => {
  assert.deepEqual(readUnsubscribeToken(unsubscribeToken(FID, "magic")), { familyId: FID, kind: "magic" });
});

test("tampered tokens are refused (other family, other kind, edited signature)", () => {
  const t = unsubscribeToken(FID, "magic");
  const [, , sig] = t.split(".");
  assert.equal(readUnsubscribeToken(`65f0c0ffee0000000000abce.magic.${sig}`), null); // another family
  assert.equal(readUnsubscribeToken(`${FID}.deeds.${sig}`), null); // another kind
  assert.equal(readUnsubscribeToken(`${FID}.magic.${sig!.slice(0, -1)}A`), null); // edited signature
  assert.equal(readUnsubscribeToken(`${FID}.everything.${sig}`), null); // unknown kind
  assert.equal(readUnsubscribeToken("garbage"), null);
  assert.equal(readUnsubscribeToken(42), null);
});

test("nothing may be appended to a valid token", () => {
  const t = unsubscribeToken(FID, "magic");
  assert.equal(readUnsubscribeToken(`${t}.extra`), null);
  assert.equal(readUnsubscribeToken(`${t}.`), null);
});
