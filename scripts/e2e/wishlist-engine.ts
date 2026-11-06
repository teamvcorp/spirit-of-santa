/**
 * E2E for Phase 6 slice 1: the wish-list points engine (no UI yet). Engine functions are called
 * directly against the dev database; tips go through the dev server's signed webhook (so the
 * "credit → allocate oldest first" path is the real one); the daily cron is called too.
 *
 *   family dev server (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/wishlist-engine.ts http://localhost:3000
 *
 * Needs the season OPEN today. Creates and removes all its own data; restores the season doc.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import mongooseLib from "mongoose";
import { connectDb, Family, Item, Kid, Payment, Season, Store, StripeEvent, Transaction, trusted, User, WishListItem } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { buildPaymentMetadata } from "@repo/payments/checkout";
import { addToList, lockFundedItems, removeFromList } from "@repo/wishlists/engine";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: wishlist-engine.ts <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
// eslint-disable-next-line turbo/no-undeclared-env-vars
const cronSecret = process.env.CRON_SECRET ?? "";
if (!whsec.startsWith("whsec_") || cronSecret.length < 16) throw new Error("STRIPE_WEBHOOK_SECRET / CRON_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const year = getSeasonYear(new Date());
const oid = () => new mongooseLib.Types.ObjectId();

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const savedSeason = await Season.collection.findOne({ year });

const user = await User.create({ email: `e2e-wl-${tag}@spiritofsanta.test`, passwordHash: "x".repeat(60), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `WL${tag}`, consent: { version: "test", acceptedAt: new Date() } });
const parent = { id: String(user._id), familyId: String(fam._id) };
const kid = await Kid.create({ familyId: fam._id, firstName: "Wl", birthYear: 2017, displayName: "W.", itemCap: 3, availableCentipoints: 1000, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const storeId = oid();
await Store.collection.insertOne({ _id: storeId, name: `E2E Toy Shop ${tag}`, slug: `e2e-wl-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
const mkItem = async (name: string, priceCents: number, inventory: number) => {
  const _id = oid();
  await Item.collection.insertOne({ _id, storeId, seasonYear: year, name, priceCents, payoutCents: Math.floor(priceCents * 0.8), inventory, status: "active", createdAt: new Date(), updatedAt: new Date() });
  return String(_id);
};
const A = await mkItem("Bike", 2500, 2);
const B = await mkItem("Book", 1000, 1);
const C = await mkItem("Sold-out game", 500, 0);
const D = await mkItem("Ball", 300, 5);
const piIds: string[] = [];
const evtIds: string[] = [];

const kidState = async () => (await Kid.findById(kid._id).lean())!;
const wl = async (itemId: string) => WishListItem.findOne({ kidId: kid._id, itemId, status: trusted({ $ne: "removed" }) }).lean();
const inv = async (itemId: string) => (await Item.findById(itemId).lean())?.inventory;
/** A tip of `cents` for the kid (no deed) through the dev server's signed webhook. */
const tip = async (cents: number) => {
  const piId = `pi_e2ewl${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2ewl${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const md = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: String(kid._id), sos_family_id: String(fam._id) });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: cents, amount_received: cents, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  const r = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  if (r.status !== 200) throw new Error(`webhook ${r.status}`);
};
/** Ledger must explain both balances exactly (escrow moves points, it never creates them). */
const ledgerAddsUp = async () => {
  const rows = await Transaction.find({ kidId: kid._id }).lean();
  const sum = (t: string) => rows.filter((r) => r.type === t).reduce((s, r) => s + r.amountCentipoints, 0);
  const k = await kidState();
  const earned = 1000 /* starting balance (test setup) */ + sum("earn_tip");
  return k.availableCentipoints === earned - sum("escrow") + sum("release") && k.escrowedCentipoints === sum("escrow") - sum("release");
};

try {
  // 1. Sold out → refused.
  check("sold-out item can't be added", JSON.stringify(await addToList(parent, String(kid._id), C)) === JSON.stringify({ ok: false, error: "soldOut" }));

  // 2. First item: escrows what the kid has (10 of 25 points).
  const a = await addToList(parent, String(kid._id), A);
  let k = await kidState();
  check("add Bike: 10 of 25 points escrowed, balance moved to escrow", a.ok && a.fundedCentipoints === 1000 && k.availableCentipoints === 0 && k.escrowedCentipoints === 1000);

  // 3. No points left → a second item can't be added (roadmap: needs ≥ 1 available point).
  const b0 = await addToList(parent, String(kid._id), B);
  check("no available points → second item refused", !b0.ok && b0.error === "noPoints");

  // 4. A $30 tip (20 points) through the real webhook: Bike (oldest) fills, 5 points left over.
  await tip(3000);
  k = await kidState();
  const wa = await wl(A);
  check("tip fills the OLDEST item first: Bike fully funded, 5 points left available",
    wa?.status === "fully_funded" && wa.fundedCentipoints === 2500 && !!wa.fullyFundedAt && k.availableCentipoints === 500 && k.escrowedCentipoints === 2500);
  check("full funding reserved one unit of stock (2 → 1)", (await inv(A)) === 1 && wa?.inventoryReserved === true);

  // 5. Now the Book can be added: takes the 5 leftover points.
  const b = await addToList(parent, String(kid._id), B);
  k = await kidState();
  check("add Book with the leftover: 5 of 10 points", b.ok && b.fundedCentipoints === 500 && k.availableCentipoints === 0);

  // 6. Duplicates + item cap.
  check("same item twice refused", JSON.stringify(await addToList(parent, String(kid._id), A)) === JSON.stringify({ ok: false, error: "alreadyListed" }));
  await Kid.updateOne({ _id: kid._id }, { $set: { itemCap: 2 } });
  check("parent's item cap enforced", JSON.stringify(await addToList(parent, String(kid._id), D)) === JSON.stringify({ ok: false, error: "cap" }));
  await Kid.updateOne({ _id: kid._id }, { $set: { itemCap: 6 } });

  // 7. Remove the funded Bike: 25 points come back and flow to the Book (needs 5); stock unit returned.
  const r = await removeFromList(parent, String(wa!._id));
  k = await kidState();
  const wb = await wl(B);
  check("remove Bike: 25 points released, Book filled (5), 20 left; Bike's unit back in stock",
    r.ok && r.releasedCentipoints === 2500 && wb?.status === "fully_funded" && k.availableCentipoints === 2000 && k.escrowedCentipoints === 1000 && (await inv(A)) === 2 && (await inv(B)) === 0);

  // 8. 30-day lock: a locked item can't be removed.
  await WishListItem.updateOne({ _id: wb!._id }, { $set: { fullyFundedAt: new Date(Date.now() - 31 * 86_400_000) } });
  const locked = await lockFundedItems();
  const rb = await removeFromList(parent, String(wb!._id));
  check("fully funded 30+ days → locked, and can't be removed", locked >= 1 && (await wl(B))?.status === "locked" && !rb.ok && rb.error === "locked");

  // 9. Sold out at the moment it fills → flagged for a substitute (stock reserved at full funding).
  const E = await mkItem("Kite", 5000, 1);
  const e = await addToList(parent, String(kid._id), E); // takes the 20 available points
  await Item.updateOne({ _id: E }, { $set: { inventory: 0 } }); // the store sells out meanwhile
  await tip(4500); // 30 points: Kite needs 30 → complete
  const we = await wl(E);
  check("item fills after the store sold out → needs a substitute", e.ok && we?.status === "fully_funded" && we.needsSubstitute === true && !we.inventoryReserved);

  // 10. Two adds at once with room for one: exactly one wins (no double-spend past the cap).
  await tip(1500); // 10 points available
  const onList = await WishListItem.countDocuments({ kidId: kid._id, status: trusted({ $ne: "removed" }) });
  await Kid.updateOne({ _id: kid._id }, { $set: { itemCap: onList + 1 } });
  const F = await mkItem("Yo-yo", 300, 3);
  const G = await mkItem("Puzzle", 300, 3);
  const [f, g] = await Promise.all([addToList(parent, String(kid._id), F), addToList(parent, String(kid._id), G)]);
  check("two parallel adds, room for one: exactly one succeeds", [f, g].filter((x) => x.ok).length === 1, JSON.stringify([f, g]));

  // 11. Ledger explains both balances exactly.
  check("ledger adds up: available + escrowed match earn/escrow/release rows", await ledgerAddsUp());

  // 12. After the Dec 1 freeze: no adds or removes.
  await Season.collection.updateOne({ year }, { $set: { forceFrozen: true } }, { upsert: true });
  const fz = await addToList(parent, String(kid._id), D);
  const anyActive = await WishListItem.findOne({ kidId: kid._id, status: trusted({ $in: ["active", "fully_funded"] }) }).lean();
  const fr = anyActive ? await removeFromList(parent, String(anyActive._id)) : { ok: false as const, error: "seasonNotOpen" as const };
  check("frozen season: adding and removing refused", !fz.ok && fz.error === "seasonNotOpen" && !fr.ok && fr.error === "seasonNotOpen");

  // 13. The daily money cron runs the wish-list steps.
  const cron = await fetch(`${base}/api/cron/money`, { headers: { authorization: `Bearer ${cronSecret}` } });
  const cj = (await cron.json()) as { wishLists?: { locked?: number } };
  check("daily cron includes wish-list lock + sweep", cron.status === 200 && typeof cj.wishLists?.locked === "number", JSON.stringify(cj.wishLists));

  // 14. Another family can't touch this list.
  const stranger = { id: String(oid()), familyId: String(fam._id) };
  check("a parent who doesn't own the family can't add or remove",
    JSON.stringify(await addToList(stranger, String(kid._id), D)) === JSON.stringify({ ok: false, error: "notFound" }) &&
      (anyActive ? JSON.stringify(await removeFromList(stranger, String(anyActive._id))) === JSON.stringify({ ok: false, error: "notFound" }) : true));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await Season.collection.deleteOne({ year });
  if (savedSeason) await Season.collection.insertOne(savedSeason);
  await WishListItem.collection.deleteMany({ kidId: kid._id });
  await Transaction.collection.deleteMany({ kidId: kid._id });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } });
  await Item.collection.deleteMany({ storeId });
  await Store.collection.deleteOne({ _id: storeId });
  await Kid.collection.deleteOne({ _id: kid._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteOne({ _id: user._id });
  await mongoose.disconnect();
}
process.exit(report());
