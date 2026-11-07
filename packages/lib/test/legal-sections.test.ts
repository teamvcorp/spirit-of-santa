import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Legal pages (/privacy, /terms, /text-messages) list their section KEYS in the page file and read the text from
// messages (<Namespace>.sections.<key>.{title,body}). A key missing from en or es renders a raw key instead of the
// legal text (year-round slice 8 review: a new Terms section was once written into the wrong namespace).
const PAGES = [
  ["privacy", "Privacy"],
  ["terms", "Terms"],
  ["text-messages", "TextMessages"],
] as const;

const read = (rel: string) => readFileSync(new URL(`../../../apps/family/${rel}`, import.meta.url), "utf8");

test("every section a legal page lists exists in English and Spanish (title + body)", () => {
  for (const [route, fallbackNs] of PAGES) {
    const page = read(`app/[locale]/${route}/page.tsx`);
    const ns = /namespace="([A-Za-z]+)"/.exec(page)?.[1] ?? fallbackNs;
    // Every `const X = [ ... ] as const` list of quoted keys that is passed as keys={X}.
    const listName = /keys=\{([A-Z_]+)\}/.exec(page)?.[1];
    assert.ok(listName, `${route}: no keys={...} list found`);
    const list = new RegExp(`const ${listName} = \\[([^\\]]*)\\]`).exec(page)?.[1] ?? "";
    const keys = [...list.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]!);
    assert.ok(keys.length > 0, `${route}: empty section list`);
    for (const locale of ["en", "es"]) {
      const msgs = JSON.parse(read(`messages/${locale}.json`)) as Record<string, { sections?: Record<string, { title?: string; body?: string }> }>;
      const sections = msgs[ns]?.sections ?? {};
      for (const k of keys) assert.ok(sections[k]?.title && sections[k]?.body, `${route} (${locale}): ${ns}.sections.${k} missing`);
    }
  }
});
