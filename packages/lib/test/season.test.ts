import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSeasonDates, getSeasonPhase, getSeasonYear, isStoreItemWindowOpen, parseIsoDay, resolveSeason, startOfDayInZone, validateSeasonDates } from "../src/season.ts";

// Instants are given in UTC. Chicago is UTC-6 in Dec (CST) and UTC-5 in Oct (CDT).
const at = (iso: string) => new Date(iso);

test("phases switch at midnight Chicago time, not UTC", () => {
  assert.equal(getSeasonPhase(at("2027-12-01T05:59:00Z")), "open"); // 11:59 pm Nov 30 CST
  assert.equal(getSeasonPhase(at("2027-12-01T06:00:00Z")), "frozen"); // 12:00 am Dec 1 CST
  assert.equal(getSeasonPhase(at("2027-10-01T04:59:00Z")), "offseason"); // 11:59 pm Sep 30 CDT
  assert.equal(getSeasonPhase(at("2027-10-01T05:00:00Z")), "open");
});

test("full-year phase map", () => {
  assert.equal(getSeasonPhase(at("2027-01-01T12:00:00Z")), "offseason");
  assert.equal(getSeasonPhase(at("2027-11-30T12:00:00Z")), "open");
  assert.equal(getSeasonPhase(at("2027-12-24T12:00:00Z")), "frozen");
  assert.equal(getSeasonPhase(at("2027-12-25T12:00:00Z")), "closed");
  assert.equal(getSeasonPhase(at("2027-12-31T12:00:00Z")), "closed");
});

test("store item window is Jan 1 - Mar 31 inclusive", () => {
  assert.equal(isStoreItemWindowOpen(at("2027-01-01T12:00:00Z")), true);
  assert.equal(isStoreItemWindowOpen(at("2027-03-31T12:00:00Z")), true);
  assert.equal(isStoreItemWindowOpen(at("2027-04-01T12:00:00Z")), false);
  assert.equal(isStoreItemWindowOpen(at("2027-12-31T12:00:00Z")), false);
});

test("season year follows the Chicago calendar at New Year", () => {
  assert.equal(getSeasonYear(at("2028-01-01T03:00:00Z")), 2027); // 9 pm Dec 31 CST
  assert.equal(getSeasonYear(at("2028-01-01T06:00:00Z")), 2028);
});

// ── Admin overrides (Phase 3 slice 2) ─────────────────────────────────────────────────

test("resolveSeason with no overrides matches the default calendar", () => {
  for (const iso of ["2027-01-01T12:00:00Z", "2027-11-30T12:00:00Z", "2027-12-01T06:00:00Z", "2027-12-25T12:00:00Z"]) {
    const s = resolveSeason(at(iso));
    assert.equal(s.phase, getSeasonPhase(at(iso)), iso);
    assert.equal(s.storeWindowOpen, isStoreItemWindowOpen(at(iso)), iso);
    assert.equal(s.phaseSource, "calendar");
  }
  assert.deepEqual(resolveSeason(at("2027-05-01T12:00:00Z")).dates, { open: "2027-10-01", freeze: "2027-12-01", close: "2027-12-25" });
});

test("custom dates move the phases, in Chicago time", () => {
  const o = { openDate: "2027-10-15", freezeDate: "2027-12-05", closeDate: "2027-12-24" };
  assert.equal(resolveSeason(at("2027-10-14T12:00:00Z"), o).phase, "offseason");
  assert.equal(resolveSeason(at("2027-10-15T04:59:00Z"), o).phase, "offseason"); // 11:59 pm Oct 14 CDT
  assert.equal(resolveSeason(at("2027-10-15T05:00:00Z"), o).phase, "open");
  assert.equal(resolveSeason(at("2027-12-04T12:00:00Z"), o).phase, "open");
  assert.equal(resolveSeason(at("2027-12-05T12:00:00Z"), o).phase, "frozen");
  assert.equal(resolveSeason(at("2027-12-24T12:00:00Z"), o).phase, "closed");
  assert.equal(resolveSeason(at("2027-11-01T12:00:00Z"), o).phaseSource, "custom");
});

test("force freeze only freezes an OPEN season", () => {
  assert.equal(resolveSeason(at("2027-11-01T12:00:00Z"), { forceFrozen: true }).phase, "frozen");
  assert.equal(resolveSeason(at("2027-11-01T12:00:00Z"), { forceFrozen: true }).phaseSource, "forced");
  assert.equal(resolveSeason(at("2027-06-01T12:00:00Z"), { forceFrozen: true }).phase, "offseason");
  assert.equal(resolveSeason(at("2027-12-26T12:00:00Z"), { forceFrozen: true }).phase, "closed");
});

test("store window switch: auto follows Jan 1–Mar 31, open/closed override it", () => {
  assert.equal(resolveSeason(at("2027-06-01T12:00:00Z"), { storeWindow: "open" }).storeWindowOpen, true);
  assert.equal(resolveSeason(at("2027-02-01T12:00:00Z"), { storeWindow: "closed" }).storeWindowOpen, false);
  assert.equal(resolveSeason(at("2027-02-01T12:00:00Z"), { storeWindow: "auto" }).storeWindowOpen, true);
});

test("dates lock once the season has opened", () => {
  assert.equal(resolveSeason(at("2027-09-30T12:00:00Z")).datesLocked, false);
  assert.equal(resolveSeason(at("2027-10-01T12:00:00Z")).datesLocked, true);
  assert.equal(resolveSeason(at("2027-10-01T12:00:00Z"), { openDate: "2027-10-20" }).datesLocked, false);
});

test("validateSeasonDates", () => {
  const now = at("2027-06-01T12:00:00Z");
  const v = (input: object, current = {}) => validateSeasonDates(2027, input, current, now);
  assert.equal(v({}), null); // all defaults
  assert.equal(v({ openDate: "2027-10-15", freezeDate: "2027-12-05", closeDate: "2027-12-24" }), null);
  assert.equal(v({ openDate: "2027-02-30" }), "invalidDate");
  assert.equal(v({ openDate: "10/15/2027" }), "invalidDate");
  assert.equal(v({ closeDate: "2028-01-02" }), "wrongYear");
  assert.equal(v({ openDate: "2027-12-10" }), "order"); // after the default freeze
  assert.equal(v({ freezeDate: "2027-12-25" }), "order"); // same day as close
  assert.equal(v({ openDate: "2027-06-01" }), "openInPast"); // today
  assert.equal(v({ openDate: "2027-05-01" }), "openInPast");
  // Season already open (by default date) → locked, whatever is typed.
  assert.equal(validateSeasonDates(2027, { openDate: "2027-11-01" }, {}, at("2027-10-02T12:00:00Z")), "locked");
  // A custom later open date keeps it editable until then.
  assert.equal(validateSeasonDates(2027, { openDate: "2027-11-01" }, { openDate: "2027-10-20" }, at("2027-10-02T12:00:00Z")), null);
});

test("startOfDayInZone: midnight in Chicago, both sides of daylight saving", () => {
  assert.equal(startOfDayInZone("2027-12-25").toISOString(), "2027-12-25T06:00:00.000Z"); // CST, UTC-6
  assert.equal(startOfDayInZone("2027-07-04").toISOString(), "2027-07-04T05:00:00.000Z"); // CDT, UTC-5
  assert.equal(startOfDayInZone("2027-03-14").toISOString(), "2027-03-14T06:00:00.000Z"); // DST starts at 2 am that day
  assert.equal(startOfDayInZone("2027-11-07").toISOString(), "2027-11-07T05:00:00.000Z"); // DST ends at 2 am that day
  assert.throws(() => startOfDayInZone("2027-02-30"));
});

test("parseIsoDay / defaultSeasonDates", () => {
  assert.deepEqual(parseIsoDay("2028-02-29"), { year: 2028, month: 2, day: 29 });
  assert.equal(parseIsoDay("2027-02-29"), null);
  assert.deepEqual(defaultSeasonDates(2030), { open: "2030-10-01", freeze: "2030-12-01", close: "2030-12-25" });
});
