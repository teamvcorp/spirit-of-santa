import { test } from "node:test";
import assert from "node:assert/strict";
import { canShipGift, defaultSeasonDates, getSeasonPhase, getSeasonYear, isStoreItemWindowOpen, newestShippableYear, parseIsoDay, shipLate, resolveSeason, santaListStart, santaListYear, startOfDayInZone, validateSeasonDates } from "../src/season.ts";

// Instants are given in UTC. Chicago is UTC-6 in Dec (CST) and UTC-5 in Oct (CDT).
const at = (iso: string) => new Date(iso);

test("phases switch at midnight Chicago time, not UTC (year-round calendar)", () => {
  assert.equal(getSeasonPhase(at("2027-12-01T05:59:00Z")), "open"); // 11:59 pm Nov 30 CST
  assert.equal(getSeasonPhase(at("2027-12-01T06:00:00Z")), "frozen"); // 12:00 am Dec 1 CST
  assert.equal(getSeasonPhase(at("2027-12-26T05:59:00Z")), "frozen"); // 11:59 pm Dec 25 CST: Christmas Day is IN the season
  assert.equal(getSeasonPhase(at("2027-12-26T06:00:00Z")), "closed"); // 12:00 am Dec 26 CST
});

test("full-year phase map: open all year except December", () => {
  assert.equal(getSeasonPhase(at("2027-01-01T12:00:00Z")), "open");
  assert.equal(getSeasonPhase(at("2027-06-15T12:00:00Z")), "open");
  assert.equal(getSeasonPhase(at("2027-11-30T12:00:00Z")), "open");
  assert.equal(getSeasonPhase(at("2027-12-25T12:00:00Z")), "frozen");
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
  for (const iso of ["2027-01-01T12:00:00Z", "2027-11-30T12:00:00Z", "2027-12-01T06:00:00Z", "2027-12-25T12:00:00Z", "2027-12-27T12:00:00Z"]) {
    const s = resolveSeason(at(iso));
    assert.equal(s.phase, getSeasonPhase(at(iso)), iso);
    assert.equal(s.storeWindowOpen, isStoreItemWindowOpen(at(iso)), iso);
    assert.equal(s.phaseSource, "calendar");
  }
  const s = resolveSeason(at("2027-05-01T12:00:00Z"));
  assert.deepEqual(s.dates, { open: "2027-01-01", freeze: "2027-12-01", close: "2027-12-26" });
  assert.equal(s.shipBy, "2027-12-10");
});

test("the Jan 1 reset gate: 'resetting' until last season's reset is done, then open", () => {
  const jan1 = at("2027-01-01T12:00:00Z");
  assert.equal(resolveSeason(jan1, { prevResetDone: false }).phase, "resetting");
  assert.equal(resolveSeason(jan1, { prevResetDone: true }).phase, "open");
  assert.equal(resolveSeason(jan1, {}).phase, "open"); // unknown = done (pure callers, tests)
  // A stuck reset never hides the closed days or wins over them.
  assert.equal(resolveSeason(at("2027-12-27T12:00:00Z"), { prevResetDone: false }).phase, "closed");
});

test("custom freeze/close move the phases; an old openDate override is ignored", () => {
  const o = { openDate: "2027-10-15", freezeDate: "2027-11-25", closeDate: "2027-12-27" };
  assert.equal(resolveSeason(at("2027-03-01T12:00:00Z"), o).phase, "open"); // open all year despite openDate
  assert.equal(resolveSeason(at("2027-11-25T05:59:00Z"), o).phase, "open"); // 11:59 pm Nov 24 CST
  assert.equal(resolveSeason(at("2027-11-25T06:00:00Z"), o).phase, "frozen");
  assert.equal(resolveSeason(at("2027-12-26T12:00:00Z"), o).phase, "frozen"); // close moved to Dec 27
  assert.equal(resolveSeason(at("2027-12-27T12:00:00Z"), o).phase, "closed");
  assert.equal(resolveSeason(at("2027-11-01T12:00:00Z"), o).phaseSource, "custom");
  assert.equal(resolveSeason(at("2027-11-01T12:00:00Z"), o).dates.open, "2027-01-01");
});

test("force freeze only freezes an OPEN season (now possible all year)", () => {
  assert.equal(resolveSeason(at("2027-06-01T12:00:00Z"), { forceFrozen: true }).phase, "frozen");
  assert.equal(resolveSeason(at("2027-06-01T12:00:00Z"), { forceFrozen: true }).phaseSource, "forced");
  assert.equal(resolveSeason(at("2027-12-28T12:00:00Z"), { forceFrozen: true }).phase, "closed");
  assert.equal(resolveSeason(at("2027-01-01T12:00:00Z"), { forceFrozen: true, prevResetDone: false }).phase, "resetting");
});

test("store window switch: auto follows Jan 1–Mar 31, open/closed override it", () => {
  assert.equal(resolveSeason(at("2027-06-01T12:00:00Z"), { storeWindow: "open" }).storeWindowOpen, true);
  assert.equal(resolveSeason(at("2027-02-01T12:00:00Z"), { storeWindow: "closed" }).storeWindowOpen, false);
  assert.equal(resolveSeason(at("2027-02-01T12:00:00Z"), { storeWindow: "auto" }).storeWindowOpen, true);
});

test("dates lock once this season's freeze date is reached", () => {
  assert.equal(resolveSeason(at("2027-11-30T12:00:00Z")).datesLocked, false);
  assert.equal(resolveSeason(at("2027-12-01T12:00:00Z")).datesLocked, true);
  assert.equal(resolveSeason(at("2027-12-01T12:00:00Z"), { freezeDate: "2027-12-03" }).datesLocked, false);
});

test("validateSeasonDates (year-round rules)", () => {
  const now = at("2027-06-01T12:00:00Z");
  const v = (input: object, current = {}) => validateSeasonDates(2027, input, current, now);
  assert.equal(v({}), null); // all defaults
  assert.equal(v({ freezeDate: "2027-11-20", closeDate: "2027-12-28" }), null);
  assert.equal(v({ freezeDate: "2027-02-30" }), "invalidDate");
  assert.equal(v({ freezeDate: "11/20/2027" }), "invalidDate");
  assert.equal(v({ closeDate: "2028-01-02" }), "wrongYear");
  assert.equal(v({ freezeDate: "2027-10-31" }), "freezeRange"); // before Nov 1
  assert.equal(v({ freezeDate: "2027-12-04" }), "freezeRange"); // after Dec 3: no time to ship by Dec 10
  assert.equal(v({ closeDate: "2027-12-25" }), "closeRange"); // Christmas Day must stay in the season
  assert.equal(v({ closeDate: "2027-12-20" }), "closeRange");
  // Locked once the CURRENT freeze date is reached.
  assert.equal(validateSeasonDates(2027, { closeDate: "2027-12-28" }, {}, at("2027-12-02T12:00:00Z")), "locked");
  // A changed freeze date must be at least a week away (families may have been told the old one).
  assert.equal(validateSeasonDates(2027, { freezeDate: "2027-11-05" }, {}, at("2027-11-01T12:00:00Z")), "freezeTooSoon");
  assert.equal(validateSeasonDates(2027, { freezeDate: "2027-11-10" }, {}, at("2027-11-01T12:00:00Z")), null);
  // Keeping the freeze date as it is never trips the "too soon" rule.
  assert.equal(validateSeasonDates(2027, { closeDate: "2027-12-28" }, {}, at("2027-11-28T12:00:00Z")), null);
});

test("startOfDayInZone: midnight in Chicago, both sides of daylight saving", () => {
  assert.equal(startOfDayInZone("2027-12-25").toISOString(), "2027-12-25T06:00:00.000Z"); // CST, UTC-6
  assert.equal(startOfDayInZone("2027-07-04").toISOString(), "2027-07-04T05:00:00.000Z"); // CDT, UTC-5
  assert.equal(startOfDayInZone("2027-03-14").toISOString(), "2027-03-14T06:00:00.000Z"); // DST starts at 2 am that day
  assert.equal(startOfDayInZone("2027-11-07").toISOString(), "2027-11-07T05:00:00.000Z"); // DST ends at 2 am that day
  assert.throws(() => startOfDayInZone("2027-02-30"));
});

test("Santa's list year: Dec 26 starts next Christmas's list", () => {
  assert.equal(santaListYear("2026-12-25"), 2026); // Christmas Day ends the 2026 list
  assert.equal(santaListYear("2026-12-26"), 2027); // the next day builds the 2027 list
  assert.equal(santaListYear("2027-01-01"), 2027);
  assert.equal(santaListYear("2027-06-15"), 2027);
  assert.equal(santaListStart(2027), "2026-12-26");
});

test("parseIsoDay / defaultSeasonDates", () => {
  assert.deepEqual(parseIsoDay("2028-02-29"), { year: 2028, month: 2, day: 29 });
  assert.equal(parseIsoDay("2027-02-29"), null);
  assert.deepEqual(defaultSeasonDates(2030), { open: "2030-01-01", freeze: "2030-12-01", close: "2030-12-26" });
});

// ── December ship window (year-round slices 3+4) ─────────────────────────────────────

test("ship window opens at the freeze date (Chicago midnight) and stays open after Christmas", () => {
  const before = resolveSeason(at("2027-12-01T05:59:00Z")); // 11:59 pm Nov 30 CST
  assert.deepEqual(before.shipping, { open: false, from: "2027-12-01", by: "2027-12-10" });
  assert.equal(resolveSeason(at("2027-12-01T06:00:00Z")).shipping.open, true);
  assert.equal(resolveSeason(at("2027-12-27T12:00:00Z")).shipping.open, true); // closed days: late beats never
  assert.equal(resolveSeason(at("2027-06-01T12:00:00Z")).shipping.open, false);
  // An admin-moved freeze date moves the window; the emergency force-freeze does NOT open it.
  assert.equal(resolveSeason(at("2027-11-26T12:00:00Z"), { freezeDate: "2027-11-25" }).shipping.open, true);
  assert.equal(resolveSeason(at("2027-06-01T12:00:00Z"), { forceFrozen: true }).shipping.open, false);
});

test("canShipGift decides per gift: last season always, this season only in its window", () => {
  const june = resolveSeason(at("2028-06-01T12:00:00Z"));
  assert.equal(canShipGift(2027, june), true); // locked Dec 26 2027, still unshipped: never held a year
  assert.equal(canShipGift(2028, june), false); // held for December
  assert.equal(newestShippableYear(june), 2027);
  const dec = resolveSeason(at("2028-12-02T12:00:00Z"));
  assert.equal(canShipGift(2028, dec), true);
  assert.equal(newestShippableYear(dec), 2028);
  const jan2 = resolveSeason(at("2028-01-02T12:00:00Z"));
  assert.equal(canShipGift(2027, jan2), true);
});

test("shipLate: 'by Dec 10' through Dec 10 Chicago time, then 'as soon as possible'; outside the window always late", () => {
  const st = (iso: string) => resolveSeason(at(iso));
  assert.equal(shipLate(st("2027-12-02T12:00:00Z"), at("2027-12-02T12:00:00Z")), false);
  assert.equal(shipLate(st("2027-12-11T05:59:00Z"), at("2027-12-11T05:59:00Z")), false); // 11:59 pm Dec 10 CST
  assert.equal(shipLate(st("2027-12-11T06:00:00Z"), at("2027-12-11T06:00:00Z")), true);
  assert.equal(shipLate(st("2028-01-05T12:00:00Z"), at("2028-01-05T12:00:00Z")), true); // only last season's gifts are ready
});
