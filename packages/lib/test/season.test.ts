import { test } from "node:test";
import assert from "node:assert/strict";
import { getSeasonPhase, isStoreItemWindowOpen, getSeasonYear } from "../src/season.ts";

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
