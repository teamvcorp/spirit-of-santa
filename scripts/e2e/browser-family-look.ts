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
const newKid = await Kid.create({ familyId: fam._id, firstName: `Ned${tag}`, birthYear: 2018, displayName: "N." }); // not registered
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
  const snow = await anon.locator(".sos-snow").first().evaluate((el) => getComputedStyle(el).display);
  check("home page has falling snow (3 depth layers in the hero)", (await anon.locator("main section").first().locator(".sos-snow").count()) === 3 && snow !== "none");
  const calm = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  await calm.goto(`${base}/`);
  await calm.locator("main h1").first().waitFor({ timeout: 60_000 });
  check("reduced motion: snow hidden", (await calm.locator(".sos-snow").first().evaluate((el) => getComputedStyle(el).display)) === "none");

  // 1b. Winter Magic / Festive (owner 2026-11-08). A DARK device must not change the family site any more.
  const themed = await (await browser.newContext({ colorScheme: "dark" })).newPage();
  themed.on("pageerror", (e) => errors.push(e.message));
  await themed.goto(`${base}/`);
  await themed.locator('[data-testid="theme-switch"] button').first().waitFor({ timeout: 60_000 });
  const look = () => themed.evaluate(() => ({ theme: document.documentElement.dataset.theme, header: getComputedStyle(document.querySelector("header")!).backgroundColor, ground: getComputedStyle(document.body).backgroundColor }));
  const before = await look();
  check("default look is Winter Magic, cream ground even on a dark-mode device", before.theme === "winter" && before.ground === "rgb(255, 248, 231)", JSON.stringify(before));
  await themed.locator('[data-testid="theme-switch"] button', { hasText: "Festive" }).click();
  await themed.waitForFunction(() => document.documentElement.dataset.theme === "festive");
  const after = await look();
  check("'Festive' recolours instantly (evergreen header) and is announced as pressed",
    after.header === "rgb(14, 70, 48)" && (await themed.locator('[data-testid="theme-switch"] button[aria-pressed="true"]').innerText()).includes("Festive"), JSON.stringify(after));
  await themed.reload();
  await themed.locator("main h1").first().waitFor({ timeout: 60_000 });
  check("the choice is remembered on this device (applied before paint, no reload flash)", (await themed.evaluate(() => document.documentElement.dataset.theme)) === "festive");
  await themed.evaluate(() => localStorage.setItem("sos.theme", "<img src=x onerror=alert(1)>"));
  await themed.reload();
  await themed.locator("main h1").first().waitFor({ timeout: 60_000 });
  check("a tampered stored value is ignored (falls back to Winter Magic)", (await themed.evaluate(() => document.documentElement.dataset.theme)) === "winter");
  await themed.setViewportSize({ width: 390, height: 844 });
  check("phones: the cottage scene is hidden (owner)", !(await themed.locator("main section").first().locator("svg[viewBox='0 0 1200 430']").isVisible()));

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

  // 4. Screen readers hear the same words as the line under the bar (percent + text).
  await page.goto(`${base}/kids/${kid._id}`);
  const bar = page.locator('main:visible [role="progressbar"]').first();
  await bar.waitFor({ timeout: 60_000 });
  check("progress bar: aria-valuenow is a percent, aria-valuetext = the visible words", (await bar.getAttribute("aria-valuenow")) === "100" && ((await bar.getAttribute("aria-valuetext")) ?? "").includes("15 of 15"));

  // 5. An unregistered child's gift browser says why adding won't work (the tab bar can reach it).
  await page.goto(`${base}/kids/${newKid._id}/gifts`);
  await page.locator("main:visible [role=status]:not([aria-busy=true])").first().waitFor({ timeout: 60_000 });
  check("unregistered child: gift browser explains 'Register this child first'", (await page.locator("main:visible").innerText()).includes("Register this child first"));

  // 6. Storage blocked (private window): the dialog still closes; Tab stays inside; Escape closes.
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }));
  await blocked.addCookies(await ctx.cookies());
  const bp = await blocked.newPage();
  bp.on("pageerror", (e) => errors.push(e.message));
  await bp.goto(`${base}/kids/${kid._id}`);
  await bp.getByRole("dialog").waitFor({ timeout: 60_000 });
  await bp.keyboard.press("Tab");
  await bp.keyboard.press("Tab");
  const focused = await bp.evaluate(() => document.activeElement?.textContent?.trim());
  check("focus stays on the dialog's button when pressing Tab", focused === "Hooray!");
  await bp.keyboard.press("Escape");
  const closed = await bp.getByRole("dialog").waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
  check("storage blocked: Escape still closes the celebration (no stuck overlay)", closed);

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await Promise.all([
    WishListItem.collection.deleteMany({ kidId: kid._id }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteMany({ _id: trusted({ $in: [kid._id, newKid._id] }) }),
    Family.deleteOne({ _id: fam._id }),
    User.deleteMany({ _id: trusted({ $in: [user._id] }) }),
  ]);
  await mongoose.disconnect();
}
report();
