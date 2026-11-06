import { test } from "node:test";
import assert from "node:assert/strict";
import { birthYearRange, defaultDisplayName, kidSchema } from "../src/schemas.ts";

const now = new Date("2027-06-01T12:00:00Z");

test("birth year: under 18 this year", () => {
  assert.deepEqual(birthYearRange(now), { min: 2010, max: 2027 });
  const s = kidSchema(now);
  assert.equal(s.safeParse({ firstName: "Maya", birthYear: "2009", displayName: "" }).success, false); // 18
  assert.equal(s.safeParse({ firstName: "Maya", birthYear: "2028", displayName: "" }).success, false); // future
  assert.equal(s.safeParse({ firstName: "Maya", birthYear: "20x0", displayName: "" }).success, false);
  assert.equal(s.parse({ firstName: "Maya", birthYear: "2010", displayName: "" }).birthYear, 2010);
});

test("display name defaults to the first initial; trimmed; max 20", () => {
  const s = kidSchema(now);
  assert.equal(s.parse({ firstName: " maya ", birthYear: "2018", displayName: " " }).displayName, "M.");
  assert.equal(s.parse({ firstName: "Élodie", birthYear: "2018", displayName: "" }).displayName, "É.");
  assert.equal(s.parse({ firstName: "Maya", birthYear: "2018", displayName: " Star Helper " }).displayName, "Star Helper");
  assert.equal(s.safeParse({ firstName: "Maya", birthYear: "2018", displayName: "x".repeat(21) }).success, false);
  assert.equal(defaultDisplayName(""), "");
});
