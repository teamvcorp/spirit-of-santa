// Run via `npm test -w @repo/lib`. The --conditions=react-server flag lets these tests
// import "server-only" modules, the same way Next's server bundle resolves them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToCentipoints, centipointsToCents, itemPriceCentsToCentipoints } from "../src/points.ts";

test("tips convert at $1.50 per point, rounding down", () => {
  assert.equal(centsToCentipoints(150), 100); // $1.50 -> 1 point
  assert.equal(centsToCentipoints(500), 333); // $5 -> 3.33 points
  assert.equal(centsToCentipoints(2500), 1666); // $25 -> 16.66 points
  assert.equal(centsToCentipoints(1), 0);
  assert.equal(centsToCentipoints(0), 0);
});

test("buying points rounds up so the platform is never short", () => {
  assert.equal(centipointsToCents(100), 150);
  assert.equal(centipointsToCents(333), 500);
  assert.equal(centipointsToCents(1), 2);
});

test("round trip never creates value", () => {
  for (let cents = 0; cents <= 10_000; cents++) {
    assert.ok(centipointsToCents(centsToCentipoints(cents)) <= cents);
  }
});

test("item point cost equals retail price", () => {
  assert.equal(itemPriceCentsToCentipoints(2999), 2999); // $29.99 -> 29.99 points
});

test("rejects non-integer, negative and unsafe input", () => {
  for (const bad of [1.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => centsToCentipoints(bad), RangeError);
    assert.throws(() => centipointsToCents(bad), RangeError);
  }
});
