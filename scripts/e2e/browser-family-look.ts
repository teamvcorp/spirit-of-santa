/**
 * Real-browser E2E (Edge) for Phase 8.5.2 (family "Winter Night" behaviour, not pixels): bottom tab
 * bar only for a signed-in family and pointing at the open child's pages; "Fully funded!" shows ONCE
 * per gift per device; snow on the home page, hidden for people who ask for reduced motion.
 *
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-look.ts http://localhost:3000
 *
 * *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { connectDb, Family, Item, Kid, Store, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-look.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `look pass ${tag}`;
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const user = await User.create({ email: `e2e-look-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Look${tag}`, parentPinHash: await hashSecret("8158"), consent: { version: "test", acceptedAt: new Date() } });
await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
const kid = await Kid.create({ familyId: fam._id, firstName: `Mia${tag}`, birthYear: 2017, displayName: "M.", escrowedCentipoints: 1500, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const storeId = oid();
const itemId = oid();
const year = getSeasonYear();
await Store.collection.insertOne({ _id: storeId, name: `Look Shop ${tag}`, slug: `e2e-look-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
await Item.collection.insertOne({ _id: itemId, storeId, seasonYear: year, name: `Kite ${tag}`, priceCents: 1500, inventory: 2, status: "active", createdAt: new Date(), updatedAt: new Date() });
await WishListItem.collection.insertOne({ kidId: kid._id, familyId: fam._id, itemId, storeId, seasonYear: year, costCentipoints: 1500, fundedCentipoints: 1500, status: "fully_funded", fullyFundedAt: new Date(), createdAt: new Date(), updatedAt: new Date() });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const tabs = (p: Page) => p.locator('nav[aria-label="Main"]');

try {
  // 1. Signed out: snow on home, no tab bar. Reduced motion: no snow.
  const anon = await (await browser.newContext()).newPage();
  anon.on("pageerror", (e) => errors.push(e.message));
  await anon.goto(`${base}/`);
  await anon.locator("main h1").first().waitFor({ timeout: 60_000 });
  check("signed out: no tab bar", (await tabs(anon).count()) === 0);
  const flakes = await anon.locator(".sos-flake").first().evaluate((el) => getComputedStyle(el).display);
  check("home page has falling snow", (await anon.locator(".sos-flake").count()) > 10 && flakes !== "none");
  const calm = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  await calm.goto(`${base}/`);
  await calm.locator("main h1").first().waitFor({ timeout: 60_000 });
  check("reduced motion: snow hidden", (await calm.locator(".sos-flake").first().evaluate((el) => getComputedStyle(el).display)) === "none");

  // 2. Signed in: tab bar, Home active.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/signin`);
  await ready(page);
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/`);
  await tabs(page).waitFor({ timeout: 60_000 });
  check("signed in: 4 tabs, Home is the current one", (await tabs(page).locator("a").count()) === 4 && (await tabs(page).locator('a[aria-current="page"]').innerText()).includes("Home"));

  // 3. Child page: celebration once; tabs follow the child.
  await page.goto(`${base}/kids/${kid._id}`);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 60_000 });
  check("first visit after full funding: 'Fully funded!' names the gift", (await dialog.innerText()).includes(`Kite ${tag}`));
  await page.getByRole("button", { name: "Hooray!" }).click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  check("on a child's page: 'Wish list' is current; 'Gifts' opens THAT child's gifts",
    (await tabs(page).locator('a[aria-current="page"]').innerText()).includes("Wish list") && ((await tabs(page).getByRole("link", { name: "Gifts" }).getAttribute("href")) ?? "").endsWith(`/kids/${kid._id}/gifts`));
  await page.reload();
  await page.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  check("celebration shows only once per gift on this device", (await page.getByRole("dialog").count()) === 0);
  await tabs(page).getByRole("link", { name: "Gifts" }).click();
  await page.waitForURL((u) => u.pathname.endsWith(`/kids/${kid._id}/gifts`), { timeout: 60_000 });
  await page.locator('nav[aria-label="Main"] a[aria-current="page"]').waitFor({ timeout: 60_000 });
  check("Gifts tab opens the child's gift browser and is current there", (await tabs(page).locator('a[aria-current="page"]').innerText()).includes("Gifts"));

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await Promise.all([
    WishListItem.collection.deleteMany({ kidId: kid._id }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteOne({ _id: kid._id }),
    Family.deleteOne({ _id: fam._id }),
    User.deleteMany({ _id: trusted({ $in: [user._id] }) }),
  ]);
  await mongoose.disconnect();
}
report();
