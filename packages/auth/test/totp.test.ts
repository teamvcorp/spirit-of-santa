import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from "../src/totp.ts";

// RFC 6238 Appendix B, SHA-1 rows (secret = ASCII "12345678901234567890", 8-digit codes).
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("TOTP matches the official RFC 6238 test vectors (8 and 6 digits)", () => {
  for (const [time, expected] of RFC_VECTORS) {
    const step = totpStep(time * 1000);
    assert.equal(totpCode(RFC_SECRET, step, 8), expected, `t=${time}`);
    assert.equal(totpCode(RFC_SECRET, step), expected.slice(-6), `t=${time} (6 digits)`);
  }
});

test("verifyTotp: accepts now ±30 s, returns the step, rejects older/newer and junk", () => {
  const now = 1_800_000_000_000;
  const step = totpStep(now);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now), step);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now), step + 1);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now), null);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now), null);
  for (const junk of ["", "12345", "1234567", "abcdef", "12 34 5"]) assert.equal(verifyTotp(RFC_SECRET, junk, now), null, junk);
  // Spaces inside a valid code are fine ("123 456" as some apps show it).
  const c = totpCode(RFC_SECRET, step);
  assert.equal(verifyTotp(RFC_SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, now), step);
});

test("base32 round trip (RFC 4648 example + random)", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Decode("mzxw 6ytb oi").toString(), "foobar");
  for (let i = 0; i < 20; i++) {
    const b = randomBytes(20);
    assert.deepEqual(base32Decode(base32Encode(b)), b);
  }
  assert.throws(() => base32Decode("not!base32"));
});

test("otpauth URI has what authenticator apps need, safely encoded", () => {
  const uri = new URL(otpauthUri(RFC_SECRET, "a+b@x.test", "Spirit O Santa Admin"));
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.searchParams.get("secret"), base32Encode(RFC_SECRET));
  assert.equal(uri.searchParams.get("issuer"), "Spirit O Santa Admin");
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
  // otpauth://totp/<label>: "totp" parses as the host, the label as the path.
  assert.equal(uri.host, "totp");
  assert.equal(decodeURIComponent(uri.pathname.slice(1)), "Spirit O Santa Admin:a+b@x.test");
});

test("recovery codes: 10 unique, readable format, normalised input", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-z2-7]{5}-[a-z2-7]{5}$/);
  const c = codes[0]!;
  assert.equal(normalizeRecoveryCode(c.toUpperCase().replace("-", " ")), c.replace("-", ""));
  for (const bad of ["", "123456", "abcde-fghi", "abcde-fghij1", "abcde-fgh1j"]) assert.equal(normalizeRecoveryCode(bad), null, bad);
});
