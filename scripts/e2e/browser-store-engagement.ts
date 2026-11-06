/**
 * Real-browser E2E (Edge) for Phase 2 slice 5: item engagement on the store dashboard.
 *
 *   node --conditions=react-server --env-file=apps/store/.env.local scripts/e2e/browser-store-engagement.ts http://localhost:3001
 *   (works against `next dev` or `next start`; no emails involved)
 *
 * Phase 6 (family wish lists) isn't built yet, so this inserts FAKE WishListItem rows with known
 * numbers into the *_dev DB, calls recordItemView() the way the family app will, and checks the
 * store pages show exactly those totals: and nothing from another store. Cleans up after itself.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { connectDb, Item, RateLimit, Store, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { recordItemView } from "@repo/stores/engagement";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-store-engagement.ts <storeUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mail = (n: string) => `e2e-eng-${n}-${tag}@spiritofsanta.test`;
const PW = `engagement pass ${tag}`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const hash = await hashSecret(PW);
const seasonYear = getSeasonYear();

async function store(n: string, status: string) {
  const owner = await User.create({ email: mail(n), passwordHash: hash, role: "store_owner", status: "active" });
  const s = await Store.create({
    name: `Eng ${n} ${tag}`, slug: `eng-${n}-${tag}`, category: "toys", status, ownerUserId: owner._id, discountBps: 2000,
    contact: { email: mail(n) },
  });
  await User.updateOne({ _id: owner._id }, { $set: { storeId: s._id } });
  return s._id;
}
const A = await store("a", "approved");
const B = await store("b", "approved");
const C = await store("c", "pending"); // families can't see pending stores: views must not count
const rep = await User.create({ email: mail("rep"), passwordHash: hash, role: "store_rep", status: "active", storeId: A, name: "Rep" });
await Store.updateOne({ _id: A }, { $push: { repUserIds: rep._id } });

const item = (storeId: unknown, name: string, priceCents?: number) =>
  Item.create({ storeId, seasonYear, name: `${name} ${tag}`, inventory: 5, ...(priceCents ? { priceCents, status: "active" } : { status: "draft" }) });
const X = await item(A, "Sled", 3000);
const Y = await item(A, "Ball", 2000);
const D = await item(A, "Draft"); // a rep's draft: not visible to families
const Z = await item(B, "Other", 1000);
const W = await item(C, "Pending", 1000);

// Fake wish lists. Expected for X: on 3 lists (removed one excluded), 2 fully funded, 1 locked,
// funding 7000 / 9000 = 77% (rounded down). Y: 1 list, 500 / 2000 = 25%.
// Store B's Z is on 5 locked lists: none of that may show up for store A.
const list = (it: { _id: unknown; storeId: unknown }, cost: number, funded: number, status: string) => ({
  kidId: oid(), familyId: oid(), itemId: it._id, storeId: it.storeId, seasonYear, costCentipoints: cost, fundedCentipoints: funded, status,
});
await WishListItem.insertMany([
  list(X, 3000, 1000, "active"),
  list(X, 3000, 3000, "fully_funded"),
  list(X, 3000, 3000, "locked"),
  list(X, 3000, 3000, "removed"),
  list(Y, 2000, 500, "active"),
  ...Array.from({ length: 5 }, () => list(Z, 1000, 1000, "locked")),
]);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function newPage() {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
async function signIn(p: Page, email: string) {
  await p.goto(`${base}/signin`);
  await ready(p);
  await p.fill('[name="email"]', email);
  await p.fill('[name="password"]', PW);
  await p.click("main button[type=submit]");
  await p.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
}
/** The first stat-tile list in <main> as { label: value }. */
const tiles = (p: Page) =>
  p.locator("main dl").first().evaluate((dl) =>
    Object.fromEntries([...dl.querySelectorAll("dt")].map((dt) => [dt.textContent?.trim() ?? "", (dt.nextElementSibling as HTMLElement | null)?.innerText.trim() ?? ""])),
  );
const rowText = (p: Page, name: string) => p.locator("main tr", { hasText: name }).first().innerText();

try {
  // 1. Views: once per viewer per item per day; only active items of approved stores.
  const famA = String(oid());
  const v1 = await recordItemView(String(X._id), { familyId: famA, ip: "203.0.113.10" });
  const v2 = await recordItemView(String(X._id), { familyId: famA, ip: "203.0.113.99" });
  check("first view counts, the same family's repeat view the same day doesn't", v1 && !v2);
  const v3 = await recordItemView(String(X._id), { familyId: String(oid()), ip: "203.0.113.10" });
  const v4 = await recordItemView(String(X._id), { ip: "198.51.100.7" });
  const v5 = await recordItemView(String(X._id), { ip: "198.51.100.7" });
  check("another family and a signed-out visitor count once each", v3 && v4 && !v5);
  const draft = await recordItemView(String(D._id), { ip: "198.51.100.8" });
  const pending = await recordItemView(String(W._id), { ip: "198.51.100.8" });
  const junk = await recordItemView("not-an-id", { ip: "198.51.100.8" });
  const missing = await recordItemView(String(oid()), { ip: "198.51.100.8" });
  check("drafts, pending stores, bad and unknown ids are never counted", !draft && !pending && !junk && !missing);
  const xViews = (await Item.findById(X._id).lean())?.stats?.views;
  check("item X has exactly 3 views", xViews === 3, String(xViews));

  // 2. Owner: items list summary + per-item columns.
  const owner = await newPage();
  await signIn(owner, mail("a"));
  await owner.goto(`${base}/dashboard/items`);
  await owner.locator("main").getByText("Engagement this season").waitFor({ timeout: 15_000 });
  const sum = await tiles(owner);
  check("summary tiles: 3 views, 4 on lists, 2 fully funded, 1 locked, 68% funded (store B excluded)",
    sum["Page views"] === "3" && sum["On wish lists"] === "4" && sum["Fully funded"] === "2" && sum["Locked in (to fulfil)"] === "1" && sum["Funding progress"]?.includes("68%"),
    JSON.stringify(sum));
  const xRow = await rowText(owner, `Sled ${tag}`);
  check("row X: 3 views, 3 on lists, 2 funded, 1 locked, 77%", /\b3\s+3\s+2\s+1\s+77%/.test(xRow.replace(/\s+/g, " ")), xRow.replace(/\s+/g, " "));
  const yRow = await rowText(owner, `Ball ${tag}`);
  check("row Y: 0 views, 1 on list, 25%", /\b0\s+1\s+0\s+0\s+25%/.test(yRow.replace(/\s+/g, " ")), yRow.replace(/\s+/g, " "));
  const bars = await owner.locator('main [role="progressbar"]').evaluateAll((els) => els.map((e) => [e.getAttribute("aria-label"), e.getAttribute("aria-valuenow")]));
  check("funding bars are labelled for screen readers with their value",
    bars.some(([l, v]) => l === `Funding for Sled ${tag}` && v === "77") && bars.some(([l, v]) => l === "Funding progress" && v === "68"), JSON.stringify(bars));
  check("nothing from store B's item appears", !(await owner.locator("main").innerText()).includes(`Other ${tag}`));
  // Optional visual check: E2E_SCREENSHOTS=<folder> saves the items page in light and dark mode.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const shots = process.env.E2E_SCREENSHOTS;
  if (shots) {
    // A fresh page per scheme, loaded in that scheme (switching an open page re-renders it).
    for (const scheme of ["light", "dark"] as const) {
      const p = await (await browser.newContext({ colorScheme: scheme })).newPage();
      await signIn(p, mail("a"));
      await p.goto(`${base}/dashboard/items`);
      await ready(p);
      const disabled = await p.locator("main button[disabled]").count();
      check(`${scheme} mode: every button enabled once the page is ready`, disabled === 0, String(disabled));
      await p.screenshot({ path: `${shots}/engagement-${scheme}.png`, fullPage: true });
      await p.context().close();
    }
  }

  // 3. Item page: its own tiles.
  await owner.goto(`${base}/dashboard/items/${X._id}`);
  await owner.locator("main").getByText("Engagement this season").waitFor({ timeout: 15_000 });
  const xt = await tiles(owner);
  check("item page tiles: 3 views, 3 on lists, 2 funded, 1 locked, 77%",
    xt["Page views"] === "3" && xt["On wish lists"] === "3" && xt["Fully funded"] === "2" && xt["Locked in (to fulfil)"] === "1" && xt["Funding progress"]?.includes("77%"),
    JSON.stringify(xt));

  // 4. Reps see the same numbers (nothing financial in them).
  const repPage = await newPage();
  await signIn(repPage, mail("rep"));
  await repPage.goto(`${base}/dashboard/items`);
  await repPage.locator("main").getByText("Engagement this season").waitFor({ timeout: 15_000 });
  check("rep sees the engagement summary", (await tiles(repPage))["On wish lists"] === "4");

  // 5. Spanish.
  await owner.goto(`${base}/es/dashboard/items`);
  await owner.locator("main").getByText("Interés esta temporada").waitFor({ timeout: 15_000 });
  check("Spanish page shows the engagement section", (await tiles(owner))["En listas de deseos"] === "4");

  // 6. Owner B sees only their own item's totals.
  const ownerB = await newPage();
  await signIn(ownerB, mail("b"));
  await ownerB.goto(`${base}/dashboard/items`);
  await ownerB.locator("main").getByText("Engagement this season").waitFor({ timeout: 15_000 });
  const bt = await tiles(ownerB);
  check("store B: 5 on lists, 5 locked, 100%, nothing of store A", bt["On wish lists"] === "5" && bt["Locked in (to fulfil)"] === "5" && bt["Funding progress"]?.includes("100%"), JSON.stringify(bt));

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const stores = [A, B, C];
  const items = await Item.find({ storeId: trusted({ $in: stores }) }).select("_id").lean();
  // Dedupe keys for our items ("view:<itemId>:<hash>"). The per-visitor cap keys can't be
  // matched (hashed) and simply expire within a day via their TTL index.
  for (const i of items) await RateLimit.collection.deleteMany({ key: { $regex: `^view:${String(i._id)}:` } });
  await WishListItem.collection.deleteMany({ storeId: { $in: stores } });
  await Item.collection.deleteMany({ storeId: { $in: stores } });
  await Store.collection.deleteMany({ _id: { $in: stores } });
  await User.collection.deleteMany({ email: { $regex: new RegExp(`-${tag}@spiritofsanta\\.test$`) } });
  await mongoose.disconnect();
}
process.exit(report());
