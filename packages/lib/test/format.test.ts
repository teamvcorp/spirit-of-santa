import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToInput, parseDollarsToCents } from "../src/format.ts";

test("parseDollarsToCents: exact integer cents, no float drift", () => {
  assert.equal(parseDollarsToCents("29.99"), 2999);
  assert.equal(parseDollarsToCents("0.29"), 29);
  assert.equal(parseDollarsToCents("19.9"), 1990);
  assert.equal(parseDollarsToCents("30"), 3000);
  assert.equal(parseDollarsToCents(" $1,299.50 "), 129950);
  assert.equal(parseDollarsToCents("4.35"), 435); // 4.35 * 100 = 434.99999 in floats
  for (const bad of ["", "abc", "-5", "1.234", "1e3", "12.", ".5", "1,2,3", "12 34", "$", "99999999"]) {
    assert.equal(parseDollarsToCents(bad), null, bad);
  }
});

test("centsToInput round-trips", () => {
  for (const c of [0, 5, 99, 100, 2999, 129950]) assert.equal(parseDollarsToCents(centsToInput(c)), c);
  assert.equal(centsToInput(2999), "29.99");
  assert.equal(centsToInput(5), "0.05");
});