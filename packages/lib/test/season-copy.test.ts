import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Year-round calendar (owner 2026-11-07): the season opens January 1, not October 1. Old copy said "from October 1"
// and was still shown on Dec 26 (review of year-round slice 2). Keep every app's copy, in both languages, free of it.
test("no app copy still promises the old October season start", () => {
  for (const app of ["family", "store", "admin"]) {
    for (const locale of ["en", "es"]) {
      const raw = readFileSync(new URL(`../../../apps/${app}/messages/${locale}.json`, import.meta.url), "utf8");
      const hits = [...raw.matchAll(/^.*\b(October|octubre)\b.*$/gim)].map((m) => m[0].trim());
      assert.deepEqual(hits, [], `${app}/${locale}: old October dates in copy`);
    }
  }
});
