import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { metadataOrigin } from "../src/site.ts";

// metadataOrigin decides the absolute address in link-preview tags. It must pick the most exact source available and
// NEVER throw (a page that fails to render is worse than a preview with a slightly wrong address).
const KEYS = ["FAMILY_APP_URL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const set = (env: Partial<Record<(typeof KEYS)[number], string>>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
};

test("the app's own *_APP_URL wins, trimmed to its origin", () => {
  set({ FAMILY_APP_URL: "https://www.spiritofsanta.com/some/path", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" });
  assert.equal(metadataOrigin("FAMILY_APP_URL", 3000).href, "https://www.spiritofsanta.com/");
});

test("Vercel production without *_APP_URL uses the production domain", () => {
  set({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "store.spiritofsanta.com", VERCEL_URL: "store-abc123.vercel.app" });
  assert.equal(metadataOrigin("FAMILY_APP_URL", 3001).href, "https://store.spiritofsanta.com/");
});

test("a Vercel preview uses that deployment's own address", () => {
  set({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "spiritofsanta.com", VERCEL_URL: "family-git-x.vercel.app" });
  assert.equal(metadataOrigin("FAMILY_APP_URL", 3000).href, "https://family-git-x.vercel.app/");
});

test("local development falls back to localhost on the app's port", () => {
  set({});
  assert.equal(metadataOrigin("FAMILY_APP_URL", 3000).href, "http://localhost:3000/");
});

test("a malformed *_APP_URL is skipped, not thrown", () => {
  set({ FAMILY_APP_URL: "not a url" });
  assert.equal(metadataOrigin("FAMILY_APP_URL", 3000).href, "http://localhost:3000/");
});
