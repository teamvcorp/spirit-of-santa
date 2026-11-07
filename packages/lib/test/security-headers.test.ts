import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, nextSecurityHeaders, securityHeaders } from "../src/security-headers.ts";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
const PROD = { https: true } as const;

test("CSP blocks framing, plugins, base hijack and off-site form posts in every app", () => {
  for (const csp of [contentSecurityPolicy(PROD), contentSecurityPolicy({ ...PROD, stripe: true })]) {
    assert.equal(directive(csp, "frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive(csp, "object-src"), "object-src 'none'");
    assert.equal(directive(csp, "base-uri"), "base-uri 'self'");
    assert.equal(directive(csp, "form-action"), "form-action 'self'");
    assert.ok(csp.includes("upgrade-insecure-requests"));
    assert.ok(!csp.includes("unsafe-eval"), "eval only in development");
    assert.ok(!csp.includes("vercel.live"), "Vercel toolbar only on previews");
  }
});

test("only the Stripe app allows Stripe; others may not frame anything", () => {
  const plain = contentSecurityPolicy(PROD);
  assert.ok(!plain.includes("stripe.com"));
  assert.equal(directive(plain, "frame-src"), "frame-src 'none'");
  const pay = contentSecurityPolicy({ ...PROD, stripe: true });
  for (const origin of ["https://js.stripe.com", "https://checkout.stripe.com", "https://hooks.stripe.com", "https://*.link.com"]) {
    assert.ok(directive(pay, "frame-src").includes(origin), origin);
  }
  assert.ok(directive(pay, "connect-src").includes("https://api.stripe.com"));
  assert.ok(directive(pay, "script-src").includes("https://js.stripe.com"));
});

test("https rules (HSTS, upgrade) only when served over HTTPS; HSTS never covers subdomains", () => {
  const local = contentSecurityPolicy({ dev: true });
  assert.ok(directive(local, "script-src").includes("'unsafe-eval'"));
  assert.ok(!local.includes("upgrade-insecure-requests"));
  assert.ok(!securityHeaders({}).some((h) => h.key === "Strict-Transport-Security"), "local next start is http");
  const hsts = securityHeaders(PROD).find((h) => h.key === "Strict-Transport-Security")?.value;
  assert.equal(hsts, "max-age=63072000");
});

test("preview deployments allow the Vercel toolbar", () => {
  const csp = contentSecurityPolicy({ ...PROD, preview: true });
  assert.ok(directive(csp, "script-src").includes("https://vercel.live"));
  assert.equal(directive(csp, "frame-src"), "frame-src https://vercel.live");
});

test("nextSecurityHeaders reads the environment (Vercel → https, preview → toolbar)", async () => {
  const saved = { VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV };
  try {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    const [rule] = await nextSecurityHeaders({ stripe: true });
    assert.equal(rule?.source, "/:path*");
    assert.ok(rule?.headers.some((h) => h.key === "Strict-Transport-Security"));
    assert.ok(!rule?.headers.find((h) => h.key === "Content-Security-Policy")?.value.includes("vercel.live"));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
