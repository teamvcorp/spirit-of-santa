// Schema-level tests. No database needed: validateSync() runs validators in memory, and
// query middleware runs before Mongoose tries to reach the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Deed, Item, Transaction, User, WishListItem } from "../src/index.ts";

const id = () => new mongoose.Types.ObjectId();
/** Paths that fail validation, e.g. ["priceCents"]. */
const errorPaths = (doc: mongoose.Document) => Object.keys(doc.validateSync()?.errors ?? {});

test("User: email normalised, role enforced, hash hidden from JSON", () => {
  const u = new User({ email: "  Parent@Example.COM ", passwordHash: "x", role: "parent" });
  assert.equal(u.email, "parent@example.com");
  assert.deepEqual(errorPaths(u), []);
  assert.equal("passwordHash" in u.toJSON(), false);
  assert.ok(errorPaths(new User({ email: "a@b.co", passwordHash: "x", role: "community" })).includes("role"));
});

test("Item: price must be a positive integer of cents, payout <= price", () => {
  const base = { storeId: id(), seasonYear: 2027, name: "Sled" };
  assert.deepEqual(errorPaths(new Item({ ...base, priceCents: 2999, payoutCents: 2000 })), []);
  assert.ok(errorPaths(new Item({ ...base, priceCents: 29.99 })).includes("priceCents"));
  assert.ok(errorPaths(new Item({ ...base, priceCents: 0 })).includes("priceCents"));
  assert.ok(errorPaths(new Item({ ...base, priceCents: 1000, payoutCents: 1500 })).includes("payoutCents"));
});

test("Deed: needs a deed type or a description", () => {
  const base = { kidId: id(), familyId: id(), seasonYear: 2027, qrTokenHash: "a".repeat(64) };
  assert.ok(errorPaths(new Deed(base)).includes("customDescription"));
  assert.deepEqual(errorPaths(new Deed({ ...base, customDescription: "Raked leaves" })), []);
});

test("WishListItem: cannot be funded beyond its cost", () => {
  const base = { kidId: id(), familyId: id(), itemId: id(), storeId: id(), seasonYear: 2027, costCentipoints: 1000 };
  assert.deepEqual(errorPaths(new WishListItem({ ...base, fundedCentipoints: 1000 })), []);
  assert.ok(errorPaths(new WishListItem({ ...base, fundedCentipoints: 1001 })).includes("fundedCentipoints"));
});

test("Transaction: positive integer amounts; adjustments need a note", () => {
  const base = { kidId: id(), familyId: id(), seasonYear: 2027 };
  assert.deepEqual(errorPaths(new Transaction({ ...base, type: "earn_tip", amountCentipoints: 333 })), []);
  assert.ok(errorPaths(new Transaction({ ...base, type: "earn_tip", amountCentipoints: 0 })).includes("amountCentipoints"));
  assert.ok(errorPaths(new Transaction({ ...base, type: "earn_tip", amountCentipoints: 1.5 })).includes("amountCentipoints"));
  assert.ok(errorPaths(new Transaction({ ...base, type: "adjustment_credit", amountCentipoints: 100 })).includes("note"));
});

test("Transaction: ledger is append-only through Mongoose", async () => {
  const blocked = /append-only/;
  await assert.rejects(Transaction.updateOne({ kidId: id() }, { amountCentipoints: 1 }).exec(), blocked);
  await assert.rejects(Transaction.deleteMany({ kidId: id() }).exec(), blocked);
  await assert.rejects(Transaction.findOneAndUpdate({ kidId: id() }, { note: "x" }, {}).exec(), blocked);
  await assert.rejects(Transaction.bulkWrite([]), blocked);
});

test("Item photo: only our Blob URL for the same pathname is accepted (review hardening)", () => {
  const base = { storeId: id(), seasonYear: 2027, name: "Sled", priceCents: 2999, payoutCents: 2000 };
  const pathname = `items/${"a".repeat(24)}/123e4567-e89b-42d3-a456-426614174000.webp`;
  const host = "https://abc123.public.blob.vercel-storage.com";
  const photoErrors = (photo: object) => errorPaths(new Item({ ...base, photo })).filter((p) => p.startsWith("photo"));
  assert.deepEqual(photoErrors({ url: `${host}/${pathname}`, pathname }), []);
  for (const url of [
    `https://evil.example/${pathname}`,
    `https://abc123.private.blob.vercel-storage.com/${pathname}`,
    `http://abc123.public.blob.vercel-storage.com/${pathname}`,
    `${host}/items/${"b".repeat(24)}/other.webp`, // URL doesn't match pathname
    `${host}/${pathname}?track=1`,
    `https://user@abc123.public.blob.vercel-storage.com/${pathname}`,
    "not a url",
  ]) {
    assert.ok(photoErrors({ url, pathname }).includes("photo.url"), url);
  }
  assert.ok(photoErrors({ url: `${host}/../x.svg`, pathname: "../x.svg" }).includes("photo.pathname"));
});
