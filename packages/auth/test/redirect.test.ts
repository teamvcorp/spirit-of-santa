import { test } from "node:test";
import assert from "node:assert/strict";
import { safeCallbackPath } from "../src/redirect.ts";

test("keeps same-site paths (with query and hash)", () => {
  assert.equal(safeCallbackPath("/"), "/");
  assert.equal(safeCallbackPath("/es/wishlist?kid=1#top"), "/es/wishlist?kid=1#top");
  assert.equal(safeCallbackPath("/dashboard"), "/dashboard");
});

test("rejects open-redirect tricks", () => {
  for (const evil of [
    "https://evil.example",
    "http://evil.example/path",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/\u0009/evil.example",
    "/\n/evil.example",
    " /dashboard",
    "",
  ]) {
    assert.equal(safeCallbackPath(evil), "/", JSON.stringify(evil));
  }
  assert.equal(safeCallbackPath(null), "/");
  assert.equal(safeCallbackPath(undefined), "/");
  assert.equal(safeCallbackPath("/" + "a".repeat(2001)), "/");
});

test("rejects dot-segment tricks that normalise to //host (review finding)", () => {
  for (const evil of [
    "/.//evil.example",
    "/.//evil.example/login",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/./\\evil.example",
    "/a/../\\evil.example",
  ]) {
    assert.equal(safeCallbackPath(evil), "/", JSON.stringify(evil));
  }
});

test("property: output is always a same-site path, never //host or /\\host", () => {
  const pieces = ["/", ".", "..", "%2e", "%2E", "\\", "//", "evil.example", "a", "?", "#", "@", ":"];
  // Exhaustive over all 4-piece combinations (13^4 = 28,561 inputs).
  for (const a of pieces) for (const b of pieces) for (const c of pieces) for (const d of pieces) {
    const out = safeCallbackPath("/" + a + b + c + d);
    assert.ok(out.startsWith("/") && !out.startsWith("//") && !out.startsWith("/\\"), `${a}${b}${c}${d} -> ${out}`);
  }
});

test("never loops back to sign-in or the auth API", () => {
  assert.equal(safeCallbackPath("/signin"), "/");
  assert.equal(safeCallbackPath("/es/signin?x=1"), "/");
  assert.equal(safeCallbackPath("/api/auth/signout"), "/");
  assert.equal(safeCallbackPath("/signing-up"), "/signing-up"); // only the exact segment
});

test("custom fallback", () => {
  assert.equal(safeCallbackPath("https://evil.example", "/store"), "/store");
});
