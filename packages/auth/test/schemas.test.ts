import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SECRET_LENGTH } from "../src/password.ts";
import { fieldErrors, MAX_PASSWORD_LENGTH, newPasswordSchema, storeRegistrationSchema } from "../src/schemas.ts";
import { slugify } from "../src/slug.ts";

const valid = {
  ownerName: "Ana Pérez",
  email: "  Ana@Example.COM ",
  password: "a long enough password",
  storeName: "Storm Lake Toys",
  category: "toys",
  description: "",
  phone: "(712) 555-0100",
  website: "",
  line1: "1 Lake Ave",
  city: "Storm Lake",
  state: "ia",
  zip: "50588",
  agree: "on",
  company_url: "",
};

test("password length limits agree between client-safe schema and server hashing", () => {
  assert.equal(MAX_PASSWORD_LENGTH, MAX_SECRET_LENGTH);
  assert.equal(newPasswordSchema.safeParse("short").success, false);
  assert.equal(newPasswordSchema.safeParse("x".repeat(257)).success, false);
  assert.equal(newPasswordSchema.safeParse("correct horse").success, true);
});

test("store registration: normalises a valid form", () => {
  const r = storeRegistrationSchema.parse(valid);
  assert.equal(r.email, "ana@example.com");
  assert.equal(r.state, "IA");
  assert.equal(r.description, undefined); // empty optional → undefined, not ""
  assert.equal(r.website, undefined);
});

test("store registration: rejects bad input with translatable codes", () => {
  const bad = storeRegistrationSchema.safeParse({
    ...valid,
    email: "not-an-email",
    password: "short",
    category: "weapons",
    website: "http://insecure.example",
    zip: "5058",
    agree: undefined,
  });
  assert.equal(bad.success, false);
  const errs = fieldErrors(bad.error!);
  assert.deepEqual(
    { email: errs.email, password: errs.password, website: errs.website, zip: errs.zip, agree: errs.agree },
    { email: "invalid", password: "tooShort", website: "httpsOnly", zip: "invalid", agree: "mustAgree" },
  );
  assert.ok(errs.category);
  // Honeypot passes validation on purpose (the flow fakes success; see schemas.ts).
  assert.equal(storeRegistrationSchema.parse({ ...valid, company_url: "http://spam" }).company_url, "http://spam");
});

test("slugify makes valid Store slugs", () => {
  assert.equal(slugify("Storm Lake Toys!"), "storm-lake-toys");
  assert.equal(slugify("Juguetería Ñandú"), "jugueteria-nandu");
  assert.equal(slugify("  --A--  "), "store-a");
  assert.equal(slugify("🎁🎄"), "store-x");
  const long = slugify("x".repeat(200));
  assert.ok(long.length <= 60);
  for (const s of ["Storm Lake Toys!", "Juguetería", "a", "", "!!!", "x".repeat(200)]) {
    assert.match(slugify(s), /^[a-z0-9-]{3,60}$/, s);
  }
});

test("store State must be a real US state (same list as the family address), case-insensitive", async () => {
  const { storeDetailsSchema } = await import("../src/schemas.ts");
  const base = { storeName: "Toy Barn", category: "toys", description: "", phone: "", website: "", line1: "1 Main", city: "Storm Lake", zip: "50588" };
  assert.equal(storeDetailsSchema.safeParse({ ...base, state: "ia" }).data?.state, "IA");
  for (const bad of ["ZZ", "XX", "", "Iowa"]) assert.equal(storeDetailsSchema.safeParse({ ...base, state: bad }).success, false, bad);
});
