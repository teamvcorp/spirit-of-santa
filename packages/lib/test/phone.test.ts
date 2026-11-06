import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPhone, toUsE164 } from "../src/phone.ts";

test("US phone numbers → E.164", () => {
  assert.equal(toUsE164("(555) 234-5678"), "+15552345678");
  assert.equal(toUsE164("555.234.5678"), "+15552345678");
  assert.equal(toUsE164("+1 555 234 5678"), "+15552345678");
  assert.equal(toUsE164("1-555-234-5678"), "+15552345678");
  assert.equal(toUsE164("5552345678"), "+15552345678");
});

test("not a valid US number → null", () => {
  assert.equal(toUsE164(""), null);
  assert.equal(toUsE164("555-1234"), null); // too short
  assert.equal(toUsE164("123-234-5678"), null); // area code can't start with 1
  assert.equal(toUsE164("555-123-4567"), null); // exchange can't start with 1
  assert.equal(toUsE164("911-234-5678"), null); // N11 service code
  assert.equal(toUsE164("+44 20 7946 0958"), null); // not US
  assert.equal(toUsE164("555-CALL-NOW"), null); // letters
  assert.equal(toUsE164("1".repeat(40)), null); // too long
});

test("masked for display", () => {
  assert.equal(maskPhone("+15552345678"), "•••-•••-5678");
});
