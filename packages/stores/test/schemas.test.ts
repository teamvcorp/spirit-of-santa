import { test } from "node:test";
import assert from "node:assert/strict";
import { discountPercentSchema, inventoryFormSchema, inviteStoreSchema, itemSchema, toItemInput } from "../src/schemas.ts";
import { wholesaleCents } from "@repo/lib/store";

test("discount % → basis points (integers, no float drift)", () => {
  const bps = (v: string) => discountPercentSchema.parse(v);
  assert.equal(bps("20"), 2000);
  assert.equal(bps("17.5"), 1750);
  assert.equal(bps("0"), 0);
  assert.equal(bps("90"), 9000);
  assert.equal(bps("33.33"), 3333);
  assert.equal(bps(" 12.05 "), 1205); // 12.05 * 100 = 1204.999… in floats: rounded, not truncated
  for (const bad of ["", "abc", "-5", "91", "100", "12.345", "1e2", "20%"]) {
    assert.equal(discountPercentSchema.safeParse(bad).success, false, bad);
  }
});

test("wholesale = retail minus discount, rounded to the cent", () => {
  assert.equal(wholesaleCents(2999, 2000), 2399); // $29.99 at 20% → $23.99 (2399.2 rounds down)
  assert.equal(wholesaleCents(1000, 1750), 825);
  assert.equal(wholesaleCents(999, 3333), 666); // 666.0 (998.99… exact-ish)
  assert.equal(wholesaleCents(1, 5000), 1); // 0.5 rounds half up
  assert.throws(() => wholesaleCents(1000, 9500));
  assert.throws(() => wholesaleCents(10.5, 2000));
});

test("invite schema: normalises email, requires category + discount", () => {
  const ok = inviteStoreSchema.parse({ storeName: "Toy Barn", ownerEmail: " Owner@Shop.COM ", category: "toys", discount: "15" });
  assert.equal(ok.ownerEmail, "owner@shop.com");
  assert.equal(ok.discount, 1500);
  assert.equal(inviteStoreSchema.safeParse({ storeName: "T", ownerEmail: "x@y.z", category: "toys", discount: "15" }).success, false);
  assert.equal(inviteStoreSchema.safeParse({ storeName: "Toy Barn", ownerEmail: "x@y.z", category: "guns", discount: "15" }).success, false);
});

test("item form: dollars → integer cents, optional fields, inventory bounds", () => {
  const ok = toItemInput(itemSchema.parse({ name: " Sled ", description: "Fast\r\nand red", category: "toys", price: "29.99", inventory: "12" }));
  assert.deepEqual(ok, { name: "Sled", description: "Fast\nand red", category: "toys", priceCents: 2999, inventory: 12 });
  const rep = toItemInput(itemSchema.parse({ name: "Ball", description: "", category: "", inventory: "0" }));
  assert.equal(rep.priceCents, undefined); // reps send no price
  assert.equal(rep.category, undefined);
  for (const price of ["0", "12.345", "-1", "abc", "10000.01"]) {
    const r = itemSchema.safeParse({ name: "X", price, inventory: "1" });
    assert.equal(r.success, false, price);
  }
  // "", " " and "12a" used to coerce to 0 ("0 in stock") instead of failing (review 2026-11-05).
  for (const inventory of ["-1", "1.5", "10000", "lots", "", " ", "12a", "1e3", "0x10", undefined]) {
    assert.equal(itemSchema.safeParse({ name: "X", price: "1", inventory }).success, false, inventory);
  }
  assert.equal(itemSchema.safeParse({ name: "X", category: "weapons", inventory: "1" }).success, false);
});

test("stock form: digits only, empty box is an error (not 0)", () => {
  assert.deepEqual(inventoryFormSchema.parse({ inventory: " 7 " }), { inventory: 7 });
  assert.deepEqual(inventoryFormSchema.parse({ inventory: "0" }), { inventory: 0 });
  for (const inventory of ["", "12a", "-3", "10000"]) assert.equal(inventoryFormSchema.safeParse({ inventory }).success, false, inventory);
});