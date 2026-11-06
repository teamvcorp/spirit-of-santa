import { test } from "node:test";
import assert from "node:assert/strict";
import { deedTypeSchema } from "../src/schemas.ts";

const base = { titleEn: "Raked leaves", titleEs: "Rastrillé hojas", descriptionEn: "", descriptionEs: "", tipMin: "", tipMax: "" };

test("deed form: titles required in both languages, trimmed", () => {
  assert.equal(deedTypeSchema.parse({ ...base, titleEn: "  Raked leaves " }).titleEn, "Raked leaves");
  assert.equal(deedTypeSchema.safeParse({ ...base, titleEs: " " }).success, false);
  assert.equal(deedTypeSchema.safeParse({ ...base, titleEn: "x".repeat(101) }).success, false);
});

test("deed form: tip range in dollars → cents, optional, ordered, capped", () => {
  const v = deedTypeSchema.parse({ ...base, tipMin: "5", tipMax: "12.50" });
  assert.equal(v.tipMin, 500);
  assert.equal(v.tipMax, 1250);
  assert.equal(deedTypeSchema.parse(base).tipMin, undefined);
  assert.equal(deedTypeSchema.safeParse({ ...base, tipMin: "20", tipMax: "5" }).success, false); // min > max
  assert.equal(deedTypeSchema.safeParse({ ...base, tipMax: "1000.01" }).success, false); // over $1,000
  assert.equal(deedTypeSchema.safeParse({ ...base, tipMin: "0" }).success, false);
  assert.equal(deedTypeSchema.safeParse({ ...base, tipMin: "abc" }).success, false);
});
