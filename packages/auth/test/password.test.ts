import { test } from "node:test";
import assert from "node:assert/strict";
import { hashSecret, needsRehash, verifySecret } from "../src/password.ts";

test("hash → verify round trip; wrong secret fails", async () => {
  const h = await hashSecret("correct horse battery staple");
  assert.match(h, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifySecret("correct horse battery staple", h), true);
  assert.equal(await verifySecret("Correct horse battery staple", h), false);
});

test("same password hashes differently each time (random salt)", async () => {
  assert.notEqual(await hashSecret("1234"), await hashSecret("1234"));
});

test("malformed, tampered or DoS-sized hashes are rejected without throwing", async () => {
  const h = await hashSecret("pw");
  assert.equal(await verifySecret("pw", "not-a-hash"), false);
  assert.equal(
    await verifySecret("pw", h.replace("m=19456", "m=4194304")),
    false,
  ); // 4 GiB
  assert.equal(await verifySecret("pw", h.slice(0, -4) + "AAAA"), false);
  assert.equal(await verifySecret("x".repeat(257), h), false); // over max length
});

test("needsRehash flags weaker parameters", async () => {
  const h = await hashSecret("pw");
  assert.equal(needsRehash(h), false);
  assert.equal(needsRehash(h.replace("t=2", "t=1")), true);
});
