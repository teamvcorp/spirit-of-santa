import { test } from "node:test";
import assert from "node:assert/strict";
import { ELF_PAGES, ELF_SPOTS, elfDay, elfSpot, findElf, readElfProgress } from "../src/elf.ts";

test("elfDay: the season's local date (Central Time), not UTC", () => {
  // 03:00 UTC on Nov 17 is still Nov 16 in Chicago.
  assert.equal(elfDay(new Date("2026-11-17T03:00:00Z")), "2026-11-16");
  assert.equal(elfDay(new Date("2026-11-17T07:00:00Z")), "2026-11-17");
});

test("elfSpot: stable for a day + page, one of the known spots, and it moves between days", () => {
  for (const page of ELF_PAGES) {
    const a = elfSpot(page, "2026-11-16");
    assert.deepEqual(a, elfSpot(page, "2026-11-16"));
    assert.ok(ELF_SPOTS.includes(a));
  }
  const days = Array.from({ length: 14 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`);
  const seen = new Set(days.map((d) => ELF_SPOTS.indexOf(elfSpot("home", d))));
  assert.ok(seen.size >= 3, "the home elf should use several spots over two weeks");
});

test("readElfProgress: other days, junk and unknown pages count as nothing found", () => {
  const day = "2026-11-16";
  assert.deepEqual(readElfProgress(null, day), { day, found: [] });
  assert.deepEqual(readElfProgress("{not json", day), { day, found: [] });
  assert.deepEqual(readElfProgress(JSON.stringify({ day: "2026-11-15", found: ["home"] }), day), { day, found: [] });
  assert.deepEqual(readElfProgress(JSON.stringify({ day, found: ["home", "home", "nope", 3] }), day), { day, found: ["home"] });
});

test("findElf: counts each page once per day", () => {
  const p0 = { day: "2026-11-16", found: [] };
  const p1 = findElf(p0, "home");
  assert.deepEqual(p1.found, ["home"]);
  assert.equal(findElf(p1, "home"), p1);
  assert.deepEqual(findElf(p1, "gifts").found, ["home", "gifts"]);
});
