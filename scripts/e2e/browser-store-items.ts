/**
 * Real-browser E2E (Edge) for Phase 2 slice 4: the store item catalog.
 *
 *   dev:   node --conditions=react-server --env-file=apps/store/.env.local scripts/e2e/browser-store-items.ts http://localhost:3001
 *   prod:  same against `next start` (no emails are involved in this flow)
 *
 * Temporarily sets this season's Season.storeWindow override (closed, then open) in the
 * *_dev DB to test both states, and restores it afterwards. Uses the real Blob store for the
 * photo step (files deleted at the end). Creates and removes its own stores/users/items.
 */
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Item, Season, Store, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { deletePublicImage } from "@repo/storage/images";
import { createItem, restoreItem } from "@repo/stores/items";
import { makeChecks } from "./lib.ts";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-store-items.ts <storeUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mail = (n: string) => `e2e-items-${n}-${tag}@spiritofsanta.test`;
const PW = `items pass ${tag}`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const hash = await hashSecret(PW);
const seasonYear = getSeasonYear();
const seasonBefore = await Season.findOne({ year: seasonYear }).lean();
const setWindow = (storeWindow: "open" | "closed" | "auto") =>
  Season.updateOne({ year: seasonYear }, { $set: { storeWindow } }, { upsert: true });

async function store(n: string, status: string) {
  const owner = await User.create({ email: mail(n), passwordHash: hash, role: "store_owner", status: "active" });
  const s = await Store.create({
    name: `Items ${n} ${tag}`, slug: `items-${n}-${tag}`, category: "toys", status, ownerUserId: owner._id, discountBps: 2000,
    contact: { email: mail(n) },
  });
  await User.updateOne({ _id: owner._id }, { $set: { storeId: s._id } });
  return String(s._id);
}
const A = await store("a", "approved");
const B = await store("b", "approved");
const rep = await User.create({ email: mail("rep"), passwordHash: hash, role: "store_rep", status: "active", storeId: A, name: "Rep" });
await Store.updateOne({ _id: A }, { $push: { repUserIds: rep._id } });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function newPage() {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => void d.accept());
  return p;
}
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const text = async (p: Page) => {
  const mains = await p.locator("main").allInnerTexts();
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (mains.length > 1 && process.env.E2E_DEBUG) console.log("DEBUG mains:", mains.map((m) => m.slice(0, 120)));
  return mains.join("\n");
};
async function signIn(p: Page, email: string) {
  await p.goto(`${base}/signin`);
  await ready(p);
  await p.fill('[name="email"]', email);
  await p.fill('[name="password"]', PW);
  await p.click("main button[type=submit]");
  await p.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
}
const photoFile = join(tmpdir(), `e2e-item-${tag}.jpg`);
const photo2 = join(tmpdir(), `e2e-item2-${tag}.png`);

try {
  const owner = await newPage();
  await signIn(owner, mail("a"));
  // A pre-existing item so stock can be tested while the window is closed.
  const seeded = await Item.create({ storeId: A, seasonYear, name: `Seeded ${tag}`, priceCents: 1000, inventory: 3, status: "active" });

  // 1. Window CLOSED: no add/edit, but stock still updates.
  await setWindow("closed");
  await owner.goto(`${base}/dashboard/items`);
  await owner.locator("main h1").waitFor();
  check("window closed: explained, no 'Add an item' button", (await text(owner)).includes("January 1 – March 31") && (await owner.locator('a[href$="/dashboard/items/new"]').count()) === 0);
  const inv = owner.locator("tr", { hasText: `Seeded ${tag}` });
  await inv.locator('input[name="inventory"]').fill("7");
  await ready(owner);
  await inv.locator("button[type=submit]").click();
  await inv.getByText("Saved").waitFor();
  check("stock can be updated outside the window", (await Item.findById(seeded._id).lean())?.inventory === 7);
  await owner.goto(`${base}/dashboard/items/${seeded._id}`);
  await owner.locator("main h1").waitFor();
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (process.env.E2E_DEBUG) console.log("DEBUG edit page:", (await text(owner)).slice(0, 400));
  check("edit form disabled while the window is closed", await owner.locator('[name="name"]').isDisabled());
  check("item page still offers a working stock update while closed", (await owner.locator(`#inv-${seeded._id}`).count()) === 1 && !(await owner.locator(`#inv-${seeded._id}`).isDisabled()));

  // 2. Window OPEN: owner adds a priced item.
  await setWindow("open");
  await owner.goto(`${base}/dashboard/items/new`);
  await ready(owner);
  await owner.fill('[name="name"]', `Red Sled ${tag}`);
  await owner.fill('main [name="description"]', "Fast.\nRed.");
  await owner.selectOption('[name="category"]', "outdoors");
  await owner.fill('[name="price"]', "12.345");
  await owner.fill('[name="inventory"]', "4");
  await owner.click("main form button[type=submit]");
  await owner.locator("main [role=alert]").first().waitFor();
  check("invalid price (12.345) rejected with a clear message", (await text(owner)).includes("like 29.99"));
  await ready(owner);
  await owner.fill('[name="price"]', "29.99");
  await owner.click("main form button[type=submit]");
  await owner.waitForURL(/created=1/, { timeout: 15_000 });
  const sled = await Item.findOne({ name: `Red Sled ${tag}` }).lean();
  check("item created: active, $29.99 stored as 2999 cents", sled?.status === "active" && sled.priceCents === 2999 && sled.inventory === 4 && sled.category === "outdoors");
  await owner.locator("main").getByText("you bill").waitFor();
  check("owner sees wholesale at the agreed 20% ($23.99)", (await text(owner)).includes("$23.99"));
  check("creation audited", !!(await AuditLog.exists({ targetType: "item", targetId: sled?._id, action: "item.create" })));

  // 3. Photo: add, then replace (old file replaced in the DB).
  writeFileSync(photoFile, await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#c9a227" } }).jpeg().toBuffer());
  writeFileSync(photo2, await sharp({ create: { width: 800, height: 600, channels: 3, background: "#1f6f43" } }).png().toBuffer());
  await ready(owner);
  await owner.setInputFiles('[name="photo"]', photoFile);
  await owner.locator("form", { has: owner.locator('[name="photo"]') }).locator("button[type=submit]").click();
  await owner.locator(`main img[alt="Red Sled ${tag}"]`).waitFor({ timeout: 30_000 });
  const p1 = (await Item.findById(sled?._id).lean())?.photo?.pathname;
  check("item photo added under items/<store>/", !!p1 && p1.startsWith(`items/${A}/`));
  await ready(owner);
  await owner.setInputFiles('[name="photo"]', photo2);
  await owner.locator("form", { has: owner.locator('[name="photo"]') }).locator("button[type=submit]").click();
  await owner.waitForFunction((old) => !document.querySelector(`main img[src*="${old.split("/").pop()}"]`), p1!, { timeout: 30_000 }).catch(() => {});
  const p2 = (await Item.findById(sled?._id).lean())?.photo?.pathname;
  check("replacing the photo swaps the file", !!p2 && p2 !== p1);

  // 4. Rep: adds an item (draft, no price); a price smuggled into the form is ignored.
  const repPage = await newPage();
  await signIn(repPage, mail("rep"));
  await repPage.goto(`${base}/dashboard/items/new`);
  await ready(repPage);
  check("rep form has no price field", (await repPage.locator('[name="price"]').count()) === 0);
  await repPage.fill('[name="name"]', `Kite ${tag}`);
  await repPage.fill('[name="inventory"]', "2");
  await repPage.locator("main form").evaluate((f) => {
    const i = document.createElement("input");
    i.type = "hidden"; i.name = "price"; i.value = "0.01"; // tampering attempt
    f.appendChild(i);
  });
  await repPage.click("main form button[type=submit]");
  await repPage.waitForURL(/created=1/, { timeout: 15_000 });
  const kite = await Item.findOne({ name: `Kite ${tag}` }).lean();
  check("rep's item is a draft with NO price (tampered price ignored)", kite?.status === "draft" && kite.priceCents == null);
  check("rep sees no archive control", (await repPage.locator("text=Archive this item").count()) === 0);

  // 5. Owner prices the draft → listed.
  await owner.goto(`${base}/dashboard/items/${kite?._id}`);
  await ready(owner);
  await owner.fill('[name="price"]', "15");
  await owner.click("main form:has([name=price]) button[type=submit]");
  await owner.locator("main").getByText("Saved.").waitFor();
  const priced = await Item.findById(kite?._id).lean();
  check("owner pricing a draft lists it ($15.00 = 1500)", priced?.status === "active" && priced.priceCents === 1500);
  check("price change audited", !!(await AuditLog.exists({ targetId: kite?._id, action: "item.price" })));


  // Review fixes: clear a category; long multi-line description kept in full.
  await owner.goto(`${base}/dashboard/items/${sled?._id}`);
  await ready(owner);
  await owner.selectOption('[name="category"]', "");
  const longDesc = Array.from({ length: 10 }, (_, i) => `Line ${i} `.padEnd(98, "x")).join("\n"); // 989 chars, 9 line breaks
  await owner.fill('main [name="description"]', longDesc);
  await owner.click("main form:has([name=price]) button[type=submit]");
  await owner.locator("main").getByText("Saved.").waitFor();
  const cleared = await Item.findById(sled?._id).lean();
  check("'No category' really clears the category", cleared?.category == null, String(cleared?.category));
  check("long multi-line description stored in full (CRLF not counted double)", cleared?.description === longDesc, `${cleared?.description?.length} vs ${longDesc.length}`);

  // Review fix: lots of archived items can't hide a rep's draft from the owner.
  await Item.insertMany(Array.from({ length: 110 }, (_, i) => ({ storeId: A, seasonYear, name: `Old ${i} ${tag}`, priceCents: 100, inventory: 0, status: "archived" })));
  const lateDraft = await Item.create({ storeId: A, seasonYear, name: `Late Draft ${tag}`, inventory: 1, status: "draft" });
  await owner.goto(`${base}/dashboard/items`);
  await owner.locator("main").getByText(`Late Draft ${tag}`).first().waitFor({ timeout: 15_000 }).catch(() => {});
  const listed = await Item.countDocuments({ storeId: A, seasonYear, status: trusted({ $ne: "archived" }) });
  check("with 110 archived items, the rep's draft is still listed and the count is right",
    (await text(owner)).includes(`Late Draft ${tag}`) && (await text(owner)).includes(`${listed} of 50`));
  await Item.deleteOne({ _id: lateDraft._id });
  // 6. 50-item limit.
  const existing = await Item.countDocuments({ storeId: A, seasonYear, status: trusted({ $ne: "archived" }) });
  await Item.insertMany(Array.from({ length: 50 - existing }, (_, i) => ({ storeId: A, seasonYear, name: `Filler ${i} ${tag}`, priceCents: 100, inventory: 1, status: "active" })));
  await owner.goto(`${base}/dashboard/items`);
  await owner.locator("main h1").waitFor();
  check("at 50 items: counter shows 50 of 50 and no Add button", (await text(owner)).includes("50 of 50") && (await owner.locator('a[href$="/dashboard/items/new"]').count()) === 0);
  await repPage.goto(`${base}/dashboard/items/new`);
  // The heading is in the static shell; wait for the streamed message itself.
  await repPage.locator("main").getByText("item limit").first().waitFor({ timeout: 15_000 }).catch(() => {});
  check("new-item page explains the limit", (await text(repPage)).includes("50-item limit"));

  // 7. Archive frees a slot; restore brings it back.
  await owner.goto(`${base}/dashboard/items/${sled?._id}`);
  await ready(owner);
  await owner.locator("main form", { hasText: "Archive" }).locator("button[type=submit]").last().click();
  await owner.locator("main").getByText("Item archived.").waitFor();
  check("archive → archived, slot freed (49 of 50)", (await Item.findById(sled?._id).lean())?.status === "archived" && (await Item.countDocuments({ storeId: A, seasonYear, status: trusted({ $ne: "archived" }) })) === 49);
  // The edit form is (correctly) disabled for an archived item, so wait for Restore itself.
  const restoreBtn = owner.locator("main form", { hasText: "Restore" }).locator("button[type=submit]").last();
  await restoreBtn.waitFor();
  await owner.waitForFunction(() => [...document.querySelectorAll("main form button[type=submit]")].some((b) => b.textContent?.includes("Restore") && !(b as HTMLButtonElement).disabled));
  await restoreBtn.click();
  await owner.locator("main").getByText("Item restored.").waitFor();
  check("restore → listed again", (await Item.findById(sled?._id).lean())?.status === "active");

  // 8. Another store's owner can't open this item.
  const ownerB = await newPage();
  await signIn(ownerB, mail("b"));
  const res = await ownerB.goto(`${base}/dashboard/items/${sled?._id}`);
  await ownerB.waitForTimeout(1000);
  check("another store's item is not found for owner B", res?.status() === 404 || !(await text(ownerB)).includes(`Red Sled ${tag}`));

  // 9. Older seasons are history (review 2026-11-05): not viewable, editable or restorable.
  const ownerA = await User.findOne({ email: mail("a") }).select("_id").lean();
  const actorA = { id: String(ownerA?._id), role: "store_owner", storeId: A };
  // Raw insert: the schema refuses years before the first season (2026), but we need a "past" one.
  const oldIns = await Item.collection.insertOne({ storeId: new mongoose.Types.ObjectId(A), seasonYear: seasonYear - 1, name: `Old Kite ${tag}`, priceCents: 500, payoutCents: 0, inventory: 1, status: "archived", stats: { views: 0 }, createdAt: new Date(), updatedAt: new Date() });
  const oldItem = { _id: oldIns.insertedId };
  const oldRes = await owner.goto(`${base}/dashboard/items/${oldItem._id}`);
  await owner.waitForTimeout(1000);
  check("last season's item is not found on its page", oldRes?.status() === 404 || !(await text(owner)).includes(`Old Kite ${tag}`));
  const oldRestore = await restoreItem(actorA, String(oldItem._id));
  check("last season's item can't be restored", !oldRestore.ok && oldRestore.error === "notFound" && (await Item.findById(oldItem._id).lean())?.status === "archived");

  // 10. Limit race: two adds at the same moment with ONE free slot → exactly one succeeds.
  await Item.updateOne({ storeId: A, seasonYear, name: `Filler 0 ${tag}` }, { $set: { status: "archived" } });
  const input = { name: `Race ${tag}`, inventory: 1, priceCents: 100 };
  const race = await Promise.all([createItem(actorA, input), createItem(actorA, input)]);
  const raceCount = await Item.countDocuments({ storeId: A, seasonYear, status: trusted({ $ne: "archived" }) });
  check("simultaneous adds for the last slot: one added, one 'limit reached', 50 total",
    race.filter((r) => r.ok).length === 1 && race.filter((r) => !r.ok && r.error === "limitReached").length === 1 && raceCount === 50,
    JSON.stringify({ race, raceCount }));

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const items = await Item.find({ storeId: trusted({ $in: [A, B] }) }).select("photo").lean();
  for (const i of items) if (i.photo?.pathname) await deletePublicImage(i.photo.pathname, { folder: "items", ownerId: A }).catch(() => {});
  await AuditLog.collection.deleteMany({ $or: [{ targetId: { $in: items.map((i) => i._id) } }, { actorUserId: { $in: [rep._id] } }] });
  await Item.collection.deleteMany({ storeId: { $in: [A, B].map((i) => new mongoose.Types.ObjectId(i)) } });
  await Store.collection.deleteMany({ _id: { $in: [A, B].map((i) => new mongoose.Types.ObjectId(i)) } });
  await User.collection.deleteMany({ email: { $regex: new RegExp(`-${tag}@spiritofsanta\\.test$`) } });
  // Restore the Season override exactly as it was.
  if (seasonBefore) await Season.collection.replaceOne({ _id: seasonBefore._id }, seasonBefore);
  else await Season.collection.deleteOne({ year: seasonYear });
  await mongoose.disconnect();
}
process.exit(report());
