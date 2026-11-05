import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeLink, renderEmail } from "../src/render.ts";

const LINK = "https://store.spiritofsanta.com/verify?token=abc123";

test("renders English and Spanish with subject, text and html", () => {
  const en = renderEmail("verifyEmail", { link: LINK }, "en");
  assert.equal(en.subject, "Confirm your email for Spirit O Santa");
  assert.ok(en.text.includes(LINK));
  assert.ok(en.html.includes('lang="en"') && en.html.includes(LINK));
  const es = renderEmail("verifyEmail", { link: LINK }, "es");
  assert.equal(es.subject, "Confirma tu correo para Spirit O Santa");
  assert.ok(es.html.includes('lang="es"'));
  // Unknown locale from a bad DB value falls back to English instead of failing.
  assert.equal(renderEmail("resetPassword", { link: LINK }, "xx").subject, "Reset your Spirit O Santa password");
});

test("user-supplied values are escaped in HTML", () => {
  // The link is the only value in these templates; it is escaped as an attribute and as text.
  const r = renderEmail("resetPassword", { link: LINK + '&x="><script>alert(1)</script>' }, "en");
  assert.ok(!r.html.includes("<script>"), "raw tags must not appear");
});

test("links must point to our hosts (or localhost in dev)", () => {
  assert.equal(assertSafeLink("http://localhost:3001/verify?token=x"), "http://localhost:3001/verify?token=x");
  assert.ok(assertSafeLink("https://admin.spiritofsanta.com/x"));
  assert.ok(assertSafeLink("https://spiritofsanta.com/es/reset"));
  for (const bad of [
    "https://evil.example/verify",
    "https://spiritofsanta.com.evil.example/x",
    "http://spiritofsanta.com/x", // must be https outside localhost
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.throws(() => assertSafeLink(bad), bad);
  }
  assert.throws(() => renderEmail("resetPassword", { link: "https://evil.example" }, "en"));
});
