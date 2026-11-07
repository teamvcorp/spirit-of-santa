/**
 * E2E for admin "hide item" (owner 2026-11-07): an admin takes ONE store item off the family site without
 * suspending the store; the store sees why; only an admin can show it again.
 *  1. Admin store page lists the store's items; "Hide from families" needs a reason.
 *  2. Hidden: not in the gift browser, no gift page, can't be added to a wish list; audited with the reason.
 *  3. The store's Items page shows "Hidden by Spirit of Santa: <reason>".
 *  4. "Show again" → back in the gift browser.
 *
 *   store :3001 + admin :3002 dev servers, then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/store/.env.local \
 *        scripts/e2e/browser-admin-item-hide.ts http://localhost:3001 http://localhost:3002
 * Needs the season OPEN (adding to a wish list). *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, Item, Kid, Store, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { browseGifts, giftDetail, parseGiftQuery } from "@repo/wishlists/catalog";
import { addToList } from "@repo/wishlists/engine";
import { createMfaAdmin, makeChecks, signIn } from "./lib.ts";

const [storeBase, adminBase] = process.argv.slice(2);
if (!storeBase || !adminBase) throw new Error("usage: browser-admin-item-hide.ts <storeUrl> <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const year = getSeasonYear();
const PW = `hide pass ${tag}`;

const owner = await User.create({ email: `e2e-hide-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "store_owner", status: "active" });
const store = await Store.create({ name: `Hide Shop ${tag}`, slug: `hide-${tag}`, category: "toys", status: "approved", ownerUserId: owner._id, discountBps: 2000, contact: { email: owner.email } });
await User.updateOne({ _id: owner._id }, { $set: { storeId: store._id } });
const item = await Item.create({ storeId: store._id, seasonYear: year, name: `Rude Mug ${tag}`, priceCents: 1200, inventory: 5, status: "active" });
const keep = await Item.create({ storeId: store._id, seasonYear: year, name: `Nice Kite ${tag}`, priceCents: 900, inventory: 5, status: "active" });
const parentUser = await User.create({ email: `e2e-hide-p-${tag}@spiritofsanta.test`, passwordHash: "x", role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: parentUser._id, familyName: `Hide${tag}`, consent: { version: "test", acceptedAt: new Date() } });
await User.updateOne({ _id: parentUser._id }, { $set: { familyId: fam._id } });
const kid = await Kid.create({ familyId: fam._id, firstName: `Hidekid${tag}`, birthYear: 2016, displayName: "H.", availableCentipoints: 500, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const parent = { id: String(parentUser._id), familyId: String(fam._id) };
const admin = await createMfaAdmin(`e2e-hide-admin-${tag}@spiritofsanta.test`);
const REASON = `Not suitable for children ${tag}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const inBrowser = async (name: string) => (await browseGifts(parseGiftQuery({ q: name }))).items.some((g) => g.name === name);
const waitFor = async (cond: () => Promise<boolean>) => {
  for (let i = 0; i < 40 && !(await cond()); i++) await page.waitForTimeout(300);
};

try {
  check("before: the item is in the gift browser", await inBrowser(`Rude Mug ${tag}`));

  // Admin signs in and opens the store.
  await page.goto(`${adminBase}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${adminBase}/stores/${store._id}`);
  const list = page.locator('[data-testid="admin-items"]');
  await list.waitFor({ timeout: 60_000 });
  check("admin store page lists the store's items", (await list.innerText()).includes(`Rude Mug ${tag}`) && (await list.innerText()).includes(`Nice Kite ${tag}`));

  // A reason is required (browser + server).
  const row = page.locator('[data-testid="admin-items"] li', { hasText: `Rude Mug ${tag}` });
  await hydrated(page);
  await row.locator('input[name="reason"]').fill(REASON);
  await row.locator("button", { hasText: "Hide from families" }).click();
  await waitFor(async () => (await Item.findById(item._id).lean())?.status === "hidden");
  const hidden = await Item.findById(item._id).lean();
  check("hidden with the reason, by this admin", hidden?.status === "hidden" && hidden.hiddenReason === REASON && String(hidden.hiddenByAdminId) === admin.id);
  check("hiding is audited with the reason", !!(await AuditLog.exists({ action: "item.hide", targetId: item._id, "details.reason": REASON })));

  // Families: gone everywhere new; the other item is untouched.
  check("hidden item is NOT in the gift browser; the other item still is", !(await inBrowser(`Rude Mug ${tag}`)) && (await inBrowser(`Nice Kite ${tag}`)));
  check("hidden item has no gift page", (await giftDetail(String(item._id))) === null);
  const add = await addToList(parent, String(kid._id), String(item._id));
  check("hidden item can't be added to a wish list", !add.ok);

  // Store sees the badge + reason.
  const cookie = (await signIn(storeBase, owner.email, PW))?.cookie ?? "";
  const sctx = await browser.newContext();
  await sctx.addCookies(cookie.split("; ").map((p) => ({ name: p.slice(0, p.indexOf("=")), value: p.slice(p.indexOf("=") + 1), url: storeBase })));
  const sp = await sctx.newPage();
  await sp.goto(`${storeBase}/dashboard/items`);
  await sp.locator('main [data-testid="item-hidden"]').first().waitFor({ timeout: 60_000 });
  check("store's Items page shows 'Hidden by Spirit of Santa' with the reason", (await sp.locator('main [data-testid="item-hidden"]').first().innerText()).includes(REASON));
  await sctx.close();

  // Show again.
  await page.reload();
  await hydrated(page);
  await page.locator('[data-testid="admin-items"] li', { hasText: `Rude Mug ${tag}` }).locator("button", { hasText: "Show again" }).click();
  await waitFor(async () => (await Item.findById(item._id).lean())?.status === "active");
  const shown = await Item.findById(item._id).lean();
  check("'Show again' → listed again (reason cleared, audited)", shown?.status === "active" && !shown.hiddenReason && !!(await AuditLog.exists({ action: "item.unhide", targetId: item._id })));
  check("back in the gift browser", await inBrowser(`Rude Mug ${tag}`));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  await WishListItem.collection.deleteMany({ kidId: kid._id });
  await AuditLog.collection.deleteMany({ targetId: trusted({ $in: [item._id, keep._id] }) as never });
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await Item.collection.deleteMany({ storeId: store._id });
  await Kid.collection.deleteOne({ _id: kid._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await Store.collection.deleteOne({ _id: store._id });
  await User.collection.deleteMany({ _id: { $in: [owner._id, parentUser._id, new mongoose.Types.ObjectId(admin.id)] } });
  await mongoose.disconnect();
}
process.exit(report());
