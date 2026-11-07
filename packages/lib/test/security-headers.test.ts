import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, securityHeaders } from "../src/security-headers.ts";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

test("CSP blocks framing, plugins, base hijack and off-site form posts in every app", () => {
  for (const csp of [contentSecurityPolicy(), contentSecurityPolicy({ stripe: true })]) {
    assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive(csp, "object-src"), "object-src 'none'");
    assert.equal(directive(csp, "base-uri"), "base-uri 'self'");
    assert.equal(directive(csp, "form-action"), "form-action 'self'");
    assert.ok(csp.includes("upgrade-insecure-requests"));
    assert.ok(!csp.includes("unsafe-eval"), "eval only in development");
  }
});

test("only the Stripe app allows Stripe; others may not frame anything", () => {
  const plain = contentSecurityPolicy();
  assert.ok(!plain.includes("stripe.com"));
  assert.equal(directive(plain, "frame-src"), "frame-src 'none'");
  const pay = contentSecurityPolicy({ stripe: true });
  for (const origin of ["https://js.stripe.com", "https://checkout.stripe.com", "https://hooks.stripe.com", "https://*.link.com"]) {
    assert.ok(directive(pay, "frame-src").includes(origin), origin);
  }
  assert.ok(directive(pay, "connect-src").includes("https://api.stripe.com"));
  assert.ok(directive(pay, "script-src").includes("https://js.stripe.com"));
});

test("dev: eval allowed, no https-only rules (dev runs on http://localhost)", () => {
  const csp = contentSecurityPolicy({ dev: true });
  assert.ok(directive(csp, "script-src").includes("'unsafe-eval'"));
  assert.ok(!csp.includes("upgrade-insecure-requests"));
  assert.ok(!securityHeaders({ dev: true }).some((h) => h.key === "Strict-Transport-Security"));
  assert.ok(securityHeaders().some((h) => h.key === "Strict-Transport-Security"));
});
