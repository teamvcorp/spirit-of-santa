import { test } from "node:test";
import assert from "node:assert/strict";

import { randomBytes } from "node:crypto";
process.env.DEED_QR_KEY = randomBytes(32).toString("base64url");
const { deedToken, hashDeedToken, isDeedToken } = await import("../src/qr.ts");
const { recordDeedSchema } = await import("../src/schemas.ts");

test("deed QR token: stable per deed, different per deed, URL-safe, hash is hex", () => {
  const a = deedToken("6a1b2c3d4e5f6a7b8c9d0e1f");
  assert.equal(a, deedToken("6a1b2c3d4e5f6a7b8c9d0e1f")); // the QR can be shown again later
  assert.notEqual(a, deedToken("6a1b2c3d4e5f6a7b8c9d0e20"));
  assert.ok(isDeedToken(a));
  assert.match(hashDeedToken(a), /^[a-f0-9]{64}$/);
  assert.ok(!hashDeedToken(a).includes(a)); // the database never holds the token itself
});

test("deed QR token depends on DEED_QR_KEY only (a DB reader can't forge it; session secret irrelevant)", () => {
  const before = deedToken("6a1b2c3d4e5f6a7b8c9d0e1f");
  process.env.NEXTAUTH_SECRET = "rotated-session-secret";
  assert.equal(deedToken("6a1b2c3d4e5f6a7b8c9d0e1f"), before); // rotating sessions keeps QRs working
  process.env.DEED_QR_KEY = randomBytes(32).toString("base64url");
  assert.notEqual(deedToken("6a1b2c3d4e5f6a7b8c9d0e1f"), before);
  process.env.DEED_QR_KEY = randomBytes(16).toString("base64url");
  assert.throws(() => deedToken("x"), /32 bytes/);
});

test("isDeedToken rejects junk", () => {
  for (const v of ["", "short", "x".repeat(44), "has space".padEnd(43, "a"), null, 42]) assert.equal(isDeedToken(v), false, String(v));
});

test("record-deed form: a catalog id OR 'other' with 3–280 characters", () => {
  assert.equal(recordDeedSchema.parse({ choice: "6A1B2C3D4E5F6A7B8C9D0E1F" }).choice, "6a1b2c3d4e5f6a7b8c9d0e1f");
  assert.equal(recordDeedSchema.safeParse({ choice: "other", other: "  hi " }).success, false);
  assert.equal(recordDeedSchema.parse({ choice: "other", other: " Helped at the library " }).other, "Helped at the library");
  assert.equal(recordDeedSchema.safeParse({ choice: "other", other: "x".repeat(281) }).success, false);
  assert.equal(recordDeedSchema.safeParse({ choice: "nonsense" }).success, false);
});
