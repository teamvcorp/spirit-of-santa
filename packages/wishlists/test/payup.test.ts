import { test } from "node:test";
import assert from "node:assert/strict";
import { payUpCents } from "../src/payup.ts";

test("pay-up price = missing points at $1.50, rounded up", () => {
  assert.equal(payUpCents(1500), 2250); // 15 points → $22.50
  assert.equal(payUpCents(333), 500); // 3.33 points → $5.00 (rounded up, never short)
});

test("pay-up is never below Stripe's $0.50 minimum", () => {
  assert.equal(payUpCents(1), 50);
  assert.equal(payUpCents(33), 50);
});
