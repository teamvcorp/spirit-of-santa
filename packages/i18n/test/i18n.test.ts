/**
 * 1) Language-switch URLs.
 * 2) Message parity: every locale file has exactly the same keys AND the same ICU
 *    placeholders as English, in this package and in every app. A missing Spanish key
 *    would otherwise only show up as a runtime warning on the page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";
import { stripLocale, switchLocalePath } from "../src/paths.ts";

test("stripLocale removes only a real locale prefix", () => {
  assert.equal(stripLocale("/es/wishlist"), "/wishlist");
  assert.equal(stripLocale("/es"), "/");
  assert.equal(stripLocale("/en/a/b"), "/a/b");
  assert.equal(stripLocale("/wishlist"), "/wishlist");
  assert.equal(stripLocale("/espanol"), "/espanol"); // not a locale, just starts with "es"
  assert.equal(stripLocale(""), "/");
});

test("switchLocalePath always produces an explicit prefix", () => {
  assert.equal(switchLocalePath("/", "es"), "/es");
  assert.equal(switchLocalePath("/es/wishlist", "en"), "/en/wishlist");
  assert.equal(switchLocalePath("/wishlist", "es"), "/es/wishlist");
});

// ── Message parity ──────────────────────────────────────────────────────────────────
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MESSAGE_DIRS = [
  "packages/i18n/messages",
  "apps/family/messages",
  "apps/store/messages",
  "apps/admin/messages",
];

type Tree = { [k: string]: string | Tree };

/** "a.b.c" → message, for every leaf. */
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

/** Top-level ICU argument names, e.g. "{count, plural, ...}" and "{name}" → count, name. */
function placeholders(msg: string): string[] {
  return [...msg.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!).sort();
}

const load = (dir: string, locale: string): Tree =>
  JSON.parse(readFileSync(join(root, dir, `${locale}.json`), "utf8"));

for (const dir of MESSAGE_DIRS) {
  test(`messages in ${dir}: same keys and placeholders in every locale`, () => {
    for (const l of LOCALES) {
      assert.ok(existsSync(join(root, dir, `${l}.json`)), `${dir}/${l}.json is missing`);
    }
    const base = flatten(load(dir, DEFAULT_LOCALE));
    for (const l of LOCALES.filter((x) => x !== DEFAULT_LOCALE)) {
      const other = flatten(load(dir, l));
      assert.deepEqual([...other.keys()].sort(), [...base.keys()].sort(), `${dir}/${l}.json keys`);
      for (const [key, msg] of base) {
        assert.deepEqual(placeholders(other.get(key)!), placeholders(msg), `${dir}/${l}.json ${key}`);
        assert.notEqual(other.get(key)!.trim(), "", `${dir}/${l}.json ${key} is empty`);
      }
    }
  });
}

test("apps never redefine the shared Common namespace", () => {
  for (const dir of MESSAGE_DIRS.filter((d) => d.startsWith("apps/"))) {
    for (const l of LOCALES) assert.ok(!("Common" in load(dir, l)), `${dir}/${l}.json defines Common`);
  }
});
