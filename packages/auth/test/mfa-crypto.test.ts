import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// A throwaway key for this test process only (the module reads it when called).
process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64url");
const { decryptSecret, encryptSecret, hashRecoveryCode } = await import("../src/mfa.ts");

test("MFA secrets: AES-GCM round trip, fresh nonce each time", () => {
  const secret = randomBytes(20);
  const a = encryptSecret(secret, "user1");
  const b = encryptSecret(secret, "user1");
  assert.notEqual(a, b); // random IV: the same secret never encrypts the same way twice
  assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(decryptSecret(a, "user1"), secret);
});

test("MFA secrets: bound to the user, tamper-evident", () => {
  const enc = encryptSecret(randomBytes(20), "user1");
  // Copied onto another user's record → refuses to decrypt.
  assert.throws(() => decryptSecret(enc, "user2"));
  // Any changed byte in the ciphertext → authentication fails.
  const [v, iv, tag, ct] = enc.split(".");
  const flipped = Buffer.from(ct!, "base64url");
  flipped[0] = flipped[0]! ^ 1;
  assert.throws(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."), "user1"));
  assert.throws(() => decryptSecret("v2.x.y.z", "user1"));
});

test("MFA key must be 32 bytes", () => {
  const good = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = randomBytes(16).toString("base64url");
  assert.throws(() => encryptSecret(randomBytes(20), "u"), /32 bytes/);
  process.env.MFA_ENCRYPTION_KEY = good;
});

test("recovery code hashes: stable, keyed, not the code itself", () => {
  const h = hashRecoveryCode("abcdefghij");
  assert.equal(h, hashRecoveryCode("abcdefghij"));
  assert.notEqual(h, hashRecoveryCode("abcdefghik"));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("abcdefghij"));
});
