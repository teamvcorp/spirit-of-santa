import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signUnlockToken,
  verifyUnlockToken,
  PIN_UNLOCK_SECONDS,
} from "../src/unlock-token.ts";
import { pinSchema } from "../src/schemas.ts";

const SECRET = "test-secret-not-used-anywhere";
const claims = { familyId: "fam1", userId: "user1" };

test("PIN must be 4-6 digits", () => {
  for (const ok of ["1234", "123456"])
    assert.equal(pinSchema.safeParse(ok).success, true);
  for (const bad of ["123", "1234567", "12a4", " 1234", ""])
    assert.equal(pinSchema.safeParse(bad).success, false);
});

test("unlock token verifies for the same family+user before expiry", () => {
  const now = Date.now();
  const t = signUnlockToken(claims, SECRET, now);
  assert.equal(verifyUnlockToken(t, claims, SECRET, now + 1000), true);
  assert.equal(
    verifyUnlockToken(t, claims, SECRET, now + PIN_UNLOCK_SECONDS * 1000 + 1),
    false,
  );
});

test("unlock token is bound to family, user and secret; tampering fails", () => {
  const t = signUnlockToken(claims, SECRET);
  assert.equal(
    verifyUnlockToken(t, { ...claims, familyId: "fam2" }, SECRET),
    false,
  );
  assert.equal(
    verifyUnlockToken(t, { ...claims, userId: "user2" }, SECRET),
    false,
  );
  assert.equal(verifyUnlockToken(t, claims, "other-secret"), false);
  const [f, u, exp, sig] = t.split(".");
  assert.equal(
    verifyUnlockToken(`${f}.${u}.${Number(exp) + 9e9}.${sig}`, claims, SECRET),
    false,
  ); // extend expiry
  assert.equal(verifyUnlockToken(undefined, claims, SECRET), false);
  assert.equal(verifyUnlockToken("a.b.c", claims, SECRET), false);
});
