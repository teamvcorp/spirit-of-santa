import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { CHECKOUT_EXCLUDED_METHODS, paymentMethodConfig } from "../src/checkout.ts";

// Spirit of Santa's own Stripe payment-method group (owner 2026-11-08: Link off, only for Spirit of Santa).
// It must never break a checkout: unset or malformed → no parameter (the account Default, today's behaviour).
const saved = process.env.STRIPE_PAYMENT_METHOD_CONFIG;
afterEach(() => {
  if (saved === undefined) delete process.env.STRIPE_PAYMENT_METHOD_CONFIG;
  else process.env.STRIPE_PAYMENT_METHOD_CONFIG = saved;
});

test("a pmc_ id is passed to Stripe (trimmed)", () => {
  process.env.STRIPE_PAYMENT_METHOD_CONFIG = " pmc_1UZZX9FOfT7vP5JsYfCJt354 ";
  assert.deepEqual(paymentMethodConfig(), { payment_method_configuration: "pmc_1UZZX9FOfT7vP5JsYfCJt354" });
});

test("unset, empty or not a pmc_ id → nothing (Stripe uses the account Default)", () => {
  delete process.env.STRIPE_PAYMENT_METHOD_CONFIG;
  assert.deepEqual(paymentMethodConfig(), {});
  for (const bad of ["", "pmc_", "pk_live_abc123456", "pmc_abc;drop", "pmc_1UZZX9FOfT7vP5JsYfCJt354\nX"]) {
    process.env.STRIPE_PAYMENT_METHOD_CONFIG = bad;
    assert.deepEqual(paymentMethodConfig(), {}, JSON.stringify(bad));
  }
});

test("checkouts never offer crypto or delayed bank debits", () => {
  for (const m of ["crypto", "us_bank_account", "customer_balance"]) assert.ok((CHECKOUT_EXCLUDED_METHODS as readonly string[]).includes(m), m);
});
