/**
 * Real-browser E2E (Edge) for Phase 6 slice 2: gift browser, gift page + "Add" (kid, no PIN),
 * the kid page's wish list, and "Remove (parent)" behind the PIN.
 *
 *   family dev server on :3000 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-wishlist.ts http://localhost:3000
 *
 * Needs the season OPEN today. Creates and removes all its own data (*_dev database only).
 */
import { randomBytes } from "node:crypto";
import mongooseLib from "mongoose";
import { chromium, type Page } from "playwright-core";
import { connectDb, Family, Item, Kid, RateLimit, Store, Transaction, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-wishlist.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `wish pass ${tag}`;
const PIN = "8153";
const year = getSeasonYear(new Date());
const oid = () => new mongooseLib.Types.ObjectId();

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");

const mkFamily = async (name: string) => {
  const user = await User.create({ email: `e2e-wish-${name}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const family = await Family.create({ ownerUserId: user._id, familyName: `Wish${name}${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: family._id } });
  return { user, family };
};
const A = await mkFamily("a");
const B = await mkFamily("b");
const registered = { status: "registered", registeredAt: new Date(), method: "card" };
const kid = await Kid.create({ familyId: A.family._id, firstName: "Ivy", birthYear: 2017, displayName: "I.", itemCap: 2, availableCentipoints: 1000, registration: registered });
const otherKid = await Kid.create({ familyId: B.family._id, firstName: "Other", birthYear: 2016, displayName: "O.", registration: registered });

// Raw inserts (like wishlist-engine.ts): the store/item models need owners/photos we don't care about here.
const approved = oid();
const pending = oid();
await Store.collection.insertMany([
  { _id: approved, name: `Aaa Toys ${tag}`, slug: `e2e-wish-a-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() },
  { _id: pending, name: `Pending Shop ${tag}`, slug: `e2e-wish-p-${tag}`, status: "pending", createdAt: new Date(), updatedAt: new Date() },
]);
const mkItem = async (storeId: mongooseLib.Types.ObjectId, name: string, priceCents: number, inventory: number, category: string) => {
  const _id = oid();
  await Item.collection.insertOne({ _id, storeId, seasonYear: year, name: `${name} ${tag}`, description: `A lovely ${name.toLowerCase()}.`, category, priceCents, payoutCents: Math.floor(priceCents * 0.8), inventory, status: "active", stats: { views: 0 }, createdAt: new Date(), updatedAt: new Date() });
  return String(_id);
};
const catToys = `Toys${tag}`;
const catBooks = `Books${tag}`;
const bike = await mkItem(approved, "Bike", 2500, 2, catToys);
const book = await mkItem(approved, "Book", 1000, 1, catBooks);
const soldOut = await mkItem(approved, "Kite", 500, 0, catToys);
const hidden = await mkItem(pending, "Drum", 800, 3, catToys);
const itemIds = [bike, book, soldOut, hidden];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    // Next 16 keeps the previous page in the DOM, hidden: only look at what is visible.
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const open = async (path: string) => {
  const res = await page.goto(`${base}${path}`);
  await page.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  return res?.status() ?? 0;
};
const gridNames = () => page.locator('main:visible [data-testid="gift-grid"] li p.font-semibold:first-child').allInnerTexts();
const K = String(kid._id);

try {
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });

  // 1. Browse (search by this run's tag): approved store only, sold-out badge shown.
  await open(`/kids/${K}/gifts?q=${tag}`);
  let names = await gridNames();
  check("browser lists the approved store's 3 gifts, not the pending store's", names.length === 3 && !names.some((n) => n.startsWith("Drum")));
  check("sold-out gift is marked 'Sold out'", (await page.locator("main:visible li", { hasText: `Kite ${tag}` }).innerText()).includes("Sold out"));
  check("default sort = price low to high (Kite 5, Book 10, Bike 25)", names.join("|") === [`Kite ${tag}`, `Book ${tag}`, `Bike ${tag}`].join("|"));

  // 2. Category + sort through the GET form (like a user).
  await page.selectOption('main:visible select[name="category"]', catToys);
  await page.selectOption('main:visible select[name="sort"]', "price_desc");
  await page.locator("main:visible form[role=search] button[type=submit]").click();
  await page.waitForURL((u) => u.searchParams.get("category") === catToys && u.searchParams.get("sort") === "price_desc", { timeout: 60_000 });
  await page.locator('main:visible [data-testid="gift-grid"]').waitFor({ timeout: 60_000 });
  names = await gridNames();
  check("category filter + price high-to-low (Bike, Kite)", names.join("|") === [`Bike ${tag}`, `Kite ${tag}`].join("|"));
  await open(`/kids/${K}/gifts?q=${tag}&sort=nonsense&page=-4`);
  check("bad sort/page values fall back to defaults (no error page)", (await gridNames()).length === 3);
  await open(`/kids/${K}/gifts?q=${tag}&page=7`);
  check("a page past the end shows the last page (not 'no gifts')", (await gridNames()).length === 3);

  // 3. Hidden things are "not found": pending store's item, another family's kid.
  // (Streamed pages send status 200 before notFound() runs inside Suspense, so check the page itself.)
  const notFoundShown = async (path: string, mustNotShow: string) => {
    await open(path);
    const text = await page.locator("main:visible").innerText();
    return text.includes("Page not found") && !text.includes(mustNotShow);
  };
  check("pending store's gift page → not found", await notFoundShown(`/kids/${K}/gifts/${hidden}`, "Drum"));
  check("another family's kid's gift browser → not found", await notFoundShown(`/kids/${otherKid._id}/gifts`, "Find gifts"));

  // 4. Gift page: price in points; "Add" (no PIN) escrows the kid's 10 points onto the Bike.
  await open(`/kids/${K}/gifts/${bike}`);
  check("gift page shows the price in points", (await page.locator('main:visible [data-testid="gift-cost"]').innerText()).includes("25 points"));
  await hydrated(page);
  await page.locator("main:visible button[type=submit]").click();
  await page.locator("main:visible [role=status]", { hasText: "Added to the wish list" }).waitFor({ timeout: 60_000 });
  const w = await WishListItem.findOne({ kidId: kid._id, itemId: bike, status: "active" }).lean();
  const k1 = await Kid.findById(kid._id).lean();
  check("Add (no PIN): Bike on the list with 10 of 25 points; kid's points moved to escrow", w?.fundedCentipoints === 1000 && k1?.availableCentipoints === 0 && k1?.escrowedCentipoints === 1000);
  // The view is counted AFTER the response (after()), so give it a moment.
  let views = 0;
  for (let i = 0; i < 20 && views !== 1; i++) {
    views = (await Item.findById(bike).lean())?.stats?.views ?? 0;
    if (views !== 1) await new Promise((r) => setTimeout(r, 250));
  }
  check("opening the gift page counted one store view", views === 1);
  await open(`/kids/${K}/gifts/${bike}`);
  check("gift already on the list: says so, Add disabled",
    (await page.locator("main:visible").innerText()).includes("already on the wish list") && (await page.locator("main:visible button[type=submit]").isDisabled()));

  // 5. Book: no spare points → the page explains and the button is disabled.
  await open(`/kids/${K}/gifts/${book}`);
  await page.locator("main:visible [role=status]").first().waitFor({ timeout: 60_000 });
  check("no spare points: hint shown, Add disabled",
    (await page.locator("main:visible [role=status]").first().innerText()).includes("at least 1 spare point") && (await page.locator("main:visible button[type=submit]").isDisabled()));
  await open(`/kids/${K}/gifts/${soldOut}`);
  check("sold-out gift: hint shown, Add disabled",
    (await page.locator("main:visible").innerText()).includes("this store has none left") && (await page.locator("main:visible button[type=submit]").isDisabled()));

  // 6. Kid page: the wish list card.
  await open(`/kids/${K}`);
  const card = page.locator('main:visible [data-testid="wish-list"]');
  await card.waitFor({ timeout: 60_000 });
  const cardText = await card.innerText();
  check("kid page lists the Bike with progress '10 of 25 points' and 'Collecting points'", cardText.includes(`Bike ${tag}`) && cardText.includes("10 of 25 points") && cardText.includes("Collecting points"));
  check("count shows '1 of 2 gifts' (the parent's cap)", (await page.locator('main:visible [data-testid="wish-count"]').innerText()).includes("1 of 2"));
  check("gift name links to its page", (await card.locator(`a[href$="/gifts/${bike}"]`).count()) === 1);
  await Store.collection.updateOne({ _id: approved }, { $set: { status: "suspended" } });
  await open(`/kids/${K}`);
  await card.waitFor({ timeout: 60_000 });
  check("store suspended: gift stays on the list but its name is no longer a (404) link",
    (await card.innerText()).includes(`Bike ${tag}`) && (await card.locator(`a[href$="/gifts/${bike}"]`).count()) === 0);
  await Store.collection.updateOne({ _id: approved }, { $set: { status: "approved" } });
  await open(`/kids/${K}`);
  await card.waitFor({ timeout: 60_000 });

  // 7. Remove (parent): locked → PIN page → back to the remove page → confirm → points back.
  await card.getByRole("link", { name: "Remove (parent)" }).click();
  const removePath = `/kids/${K}/wishlist/${w!._id}/remove`;
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin") && u.searchParams.get("next") === removePath, { timeout: 60_000 });
  check("Remove needs the parent PIN (and remembers the remove page)", true);
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith(removePath), { timeout: 60_000 });
  await page.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  check("after the PIN, back on the remove page showing the points that return",
    (await page.locator("main:visible").innerText()).includes("Its 10 points go back"));
  await hydrated(page);
  await page.getByRole("button", { name: "Remove it" }).click();
  await page.waitForURL((u) => u.pathname.endsWith(`/kids/${K}`), { timeout: 60_000 });
  const w2 = await WishListItem.findById(w!._id).lean();
  const k2 = await Kid.findById(kid._id).lean();
  check("removed: status 'removed', 10 points back to available, escrow 0", w2?.status === "removed" && k2?.availableCentipoints === 1000 && k2?.escrowedCentipoints === 0);
  await page.locator("main:visible #wishlist").waitFor({ timeout: 60_000 });
  check("kid page shows the empty list again", (await page.locator("main:visible").innerText()).includes("Nothing on the list yet"));

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  const users = [A.user._id, B.user._id];
  await Promise.all([
    WishListItem.deleteMany({ kidId: trusted({ $in: [kid._id, otherKid._id] }) }),
    // Ledger is append-only through the model; test rows are removed with the raw collection.
    Transaction.collection.deleteMany({ kidId: { $in: [kid._id, otherKid._id] } }),
    Kid.deleteMany({ _id: trusted({ $in: [kid._id, otherKid._id] }) }),
    Family.deleteMany({ _id: trusted({ $in: [A.family._id, B.family._id] }) }),
    User.deleteMany({ _id: trusted({ $in: users }) }),
    Item.deleteMany({ _id: trusted({ $in: itemIds }) }),
    Store.deleteMany({ _id: trusted({ $in: [approved, pending] }) }),
    // Only this run's per-item view keys (the per-visitor daily cap key expires on its own).
    RateLimit.collection.deleteMany({ key: { $regex: `^view:(${itemIds.join("|")}):` } }),
  ]);
  await mongoose.disconnect();
}
report();
