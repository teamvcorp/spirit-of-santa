import { test } from "node:test";
import assert from "node:assert/strict";
import { ipKey } from "../src/rate-limit.ts";
import { storeRegistrationSchema } from "../src/schemas.ts";

test("ipKey: IPv4 stays as-is; IPv6 is grouped by /64 (one attacker can't rotate addresses)", () => {
  assert.equal(ipKey("203.0.113.7"), "203.0.113.7");
  assert.equal(ipKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(ipKey("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd:12::/64");
  assert.equal(ipKey("2001:db8:abcd:12:ffff:ffff:ffff:ffff"), "2001:db8:abcd:12::/64"); // same /64
  assert.equal(ipKey("2001:0db8:00ab:0000::1"), "2001:db8:ab:0::/64"); // zero-compressed + padded
  assert.equal(ipKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(ipKey("::1"), "0:0:0:0::/64");
  assert.notEqual(ipKey("2001:db8:abcd:12::1"), ipKey("2001:db8:abcd:13::1")); // different /64
  assert.equal(ipKey("unknown"), "unknown");
});

test("textarea line breaks (CRLF) don't count double against the length limit", () => {
  const base = {
    ownerName: "A", email: "a@example.com", password: "long enough pw", storeName: "Shop",
    category: "toys", line1: "1 St", city: "C", state: "IA", zip: "50588", agree: "on",
  };
  const text = "line\r\n".repeat(399) + "end"; // 2000 chars with LF, 2399 with CRLF
  const r = storeRegistrationSchema.safeParse({ ...base, description: text });
  assert.equal(r.success, true);
  assert.ok(r.success && !r.data.description?.includes("\r"));
});
