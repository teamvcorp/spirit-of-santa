/**
 * E2E for year-round slice 7 (owner 2026-11-07):
 *  1. Jan 1 catalogue carry-over (copyLastSeasonCatalog): last season's ACTIVE items of approved/pending stores
 *     are copied into the new season once (name, photo, price, stock left); drafts, archived items and
 *     suspended stores' items are not; a second run (or a lost flag) never duplicates; outside Q1 it does nothing.
 *  2. Stock compare-and-set (setInventory / updateItem): a form showing a stale number gets "stockChanged" instead
 *     of overwriting a unit a child's gift reserved meanwhile; the full item form leaves stock alone when unchanged.
 * Service level (no browser), against the dev database:
 *   node --conditions=react-server --env-file=apps/store/.env.local scripts/e2e/store-catalog.ts
 * *_dev database only. Creates and removes all its own data (and every copy made during the run).
 */
import { randomBytes } from "node:crypto";
import { connectDb, Item, Season, Store, User } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { copyLastSeasonCatalog } from "@repo/stores/catalog-rollover";
import { setInventory, updateItem } from "@repo/stores/items";
import { getSeasonState } from "@repo/stores/season";
import { makeChecks } from "./lib.ts";

const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const started = new Date();
const year = getSeasonYear();
const next = year + 1;
// A moment inside NEXT year's Q1 (Jan 2, noon Chicago): the season year is `next`, last season is `year`.
const jan2 = new Date(`${next}-01-02T18:00:00Z`);
const savedNext = await Season.collection.findOne({ year: next });

const owner = await User.create({ email: `e2e-cat-${tag}@spiritofsanta.test`, passwordHash: "x", role: "store_owner", status: "active" });
const store = await Store.create({ name: `Cat ${tag}`, slug: `cat-${tag}`, category: "toys", status: "approved", ownerUserId: owner._id, discountBps: 2000, contact: { email: owner.email } });
await User.updateOne({ _id: owner._id }, { $set: { storeId: store._id } });
const susOwner = await User.create({ email: `e2e-cat-s-${tag}@spiritofsanta.test`, passwordHash: "x", role: "store_owner", status: "active" });
const suspended = await Store.create({ name: `CatS ${tag}`, slug: `cat-s-${tag}`, category: "toys", status: "suspended", ownerUserId: susOwner._id, discountBps: 2000, contact: { email: susOwner.email } });
const mk = (s: unknown, extra: Record<string, unknown>) => Item.create({ storeId: s, seasonYear: year, name: `Thing ${tag}`, priceCents: 1500, inventory: 4, status: "active", ...extra });
// Raw insert: the photo validator only accepts our real Blob store URLs (this one is a stand-in).
const kite = { _id: new mongoose.Types.ObjectId() };
await Item.collection.insertOne({ _id: kite._id, storeId: store._id, seasonYear: year, name: `Kite ${tag}`, priceCents: 1500, inventory: 3, status: "active", photo: { url: `https://example.test/kite-${tag}.png`, pathname: `items/kite-${tag}.png` }, createdAt: new Date(), updatedAt: new Date() });
const draft = await mk(store._id, { name: `Draft ${tag}`, status: "draft", priceCents: undefined });
const archived = await mk(store._id, { name: `Old ${tag}`, status: "archived" });
const susItem = await mk(suspended._id, { name: `Sus ${tag}` });
const owner2 = await User.create({ email: `e2e-cat-2-${tag}@spiritofsanta.test`, passwordHash: "x", role: "store_owner", status: "active" });
const store2 = await Store.create({ name: `Cat2 ${tag}`, slug: `cat-2-${tag}`, category: "toys", status: "approved", ownerUserId: owner2._id, discountBps: 2000, contact: { email: owner2.email } });
const actor = { id: String(owner._id), role: "store_owner", storeId: String(store._id) };

try {
  // ── 1. Carry-over.
  check("outside Q1 (today): does nothing", (await copyLastSeasonCatalog()).status === "notQ1");
  // Admin closed the store window: no copies (stores couldn't fix or archive them).
  await Season.collection.updateOne({ year: next }, { $set: { year: next, storeWindow: "closed" } }, { upsert: true });
  check("store window closed by an admin: does nothing", (await copyLastSeasonCatalog(jan2)).status === "windowClosed");
  await Season.collection.updateOne({ year: next }, { $set: { storeWindow: "auto" } });
  // A second store that ALREADY entered its own item this season (e.g. the copy ran late): must be skipped.
  const own = await mk(store2._id, { name: `Own ${tag}`, seasonYear: next });
  const src2 = await mk(store2._id, { name: `Src2 ${tag}` });
  const r1 = await copyLastSeasonCatalog(jan2);
  const copies = await Item.find({ seasonYear: next, storeId: store._id }).lean();
  const kiteCopy = copies.find((c) => String(c.copiedFromItemId) === String(kite._id));
  check("Jan 2: the active item is copied into the new season with name, photo, price and stock", r1.status === "done" && r1.year === next &&
    !!kiteCopy && kiteCopy.name === `Kite ${tag}` && kiteCopy.priceCents === 1500 && kiteCopy.inventory === 3 && kiteCopy.photo?.pathname === `items/kite-${tag}.png` && kiteCopy.status === "active", JSON.stringify(r1));
  check("drafts and archived items are NOT copied", copies.length === 1 && !copies.some((c) => [String(draft._id), String(archived._id)].includes(String(c.copiedFromItemId))));
  check("a suspended store's items are NOT copied", !(await Item.exists({ seasonYear: next, copiedFromItemId: susItem._id })));
  check("a store that already entered its own items is SKIPPED (no duplicates, limit safe)",
    !(await Item.exists({ copiedFromItemId: src2._id })) && (await Item.countDocuments({ storeId: store2._id, seasonYear: next })) === 1 && r1.status === "done" && r1.skippedOwnItems >= 1 && !!own);
  check("each store is marked done for the season", (await Store.findById(store._id).lean())?.catalogCopiedYear === next);
  // Marker lost (crash between copy and marker is impossible in one transaction, but a manual reset): still one copy.
  await Store.collection.updateOne({ _id: store._id }, { $unset: { catalogCopiedYear: 1 } });
  await copyLastSeasonCatalog(jan2);
  check("re-run without the marker: still exactly one copy (keyed by the source item)", (await Item.countDocuments({ copiedFromItemId: kite._id })) === 1);
  // A store reinstated later in Q1 is copied on a later run.
  await Store.collection.updateOne({ _id: suspended._id }, { $set: { status: "approved" } });
  await copyLastSeasonCatalog(jan2);
  check("a store reinstated later in Q1 is copied on the next run", (await Item.countDocuments({ copiedFromItemId: susItem._id })) === 1);

  // ── 2. Stock compare-and-set (current season item).
  if ((await getSeasonState()).phase === "open" || (await getSeasonState()).phase === "frozen") {
    // A child's gift reserves one unit (4 → 3) while the store's form still shows 4.
    const doll = await mk(store._id, { name: `Doll ${tag}`, inventory: 4 });
    await Item.updateOne({ _id: doll._id }, { $inc: { inventory: -1 } });
    const stale = await setInventory(actor, String(doll._id), 10, 4);
    check("stale stock form (showed 4, now 3): refused 'stockChanged' with the current number, the reservation is kept", !stale.ok && stale.error === "stockChanged" && stale.inventoryNow === 3 && (await Item.findById(doll._id).lean())?.inventory === 3);
    const fresh = await setInventory(actor, String(doll._id), 10, 3);
    check("form showing the current number: saved", fresh.ok && (await Item.findById(doll._id).lean())?.inventory === 10);
    // Full item form, stock untouched by the store: a reservation in between must survive the save.
    await Item.updateOne({ _id: doll._id }, { $inc: { inventory: -1 } }); // 10 → 9
    const s = await getSeasonState();
    if (s.storeWindowOpen) {
      const u = await updateItem(actor, String(doll._id), { name: `Doll2 ${tag}`, priceCents: 1500, inventory: 10 }, 10);
      const d = await Item.findById(doll._id).lean();
      check("item form with stock unchanged: saves the name, keeps the reserved stock (9)", u.ok && d?.name === `Doll2 ${tag}` && d.inventory === 9);
    } else {
      check("item form refused outside the store window (stock form still works)", (await updateItem(actor, String(doll._id), { name: "x", priceCents: 1500, inventory: 10 }, 10)).ok === false);
    }
  }
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  // Every copy this run made (any store: the job copies the whole dev DB), then our own data.
  await Item.collection.deleteMany({ seasonYear: next, copiedFromItemId: { $exists: true }, createdAt: { $gte: started } });
  await Item.collection.deleteMany({ storeId: { $in: [store._id, suspended._id, store2._id] } });
  // Other dev stores the job marked for next year: unmark (their copies were deleted above).
  await Store.collection.updateMany({ catalogCopiedYear: next }, { $unset: { catalogCopiedYear: 1 } });
  await Season.collection.deleteOne({ year: next });
  if (savedNext) await Season.collection.insertOne(savedNext);
  await Store.collection.deleteMany({ _id: { $in: [store._id, suspended._id, store2._id] } });
  await User.collection.deleteMany({ _id: { $in: [owner._id, susOwner._id, owner2._id] } });
  await mongoose.disconnect();
}
process.exit(report());
