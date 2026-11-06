/**
 * Real-browser E2E (Edge) for Phase 3 slice 4: admin deed catalog (/deeds).
 *
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-deeds.ts http://localhost:3002
 *
 * The catalog is shared data: this BACKS UP every DeedType in the *_dev DB, empties the
 * collection (to test the "suggested deeds" button), and restores the exact originals at the
 * end, even if a check fails. Uses its own MFA admin.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, DeedType, User } from "@repo/db";
import { seedStarterDeeds, STARTER_DEEDS } from "@repo/deeds/catalog";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-admin-deeds.ts <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const backup = await DeedType.collection.find({}).toArray();
await DeedType.collection.deleteMany({});
const admin = await createMfaAdmin(`e2e-deeds-${tag}@spiritofsanta.test`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const order = async () => (await DeedType.find().sort({ sortOrder: 1, createdAt: 1 }).lean()).map((d) => d.title.en);
const audits = (action: string) => AuditLog.countDocuments({ actorUserId: new mongoose.Types.ObjectId(admin.id), action });
const listTitles = () => page.locator("main ol > li a").allInnerTexts();

try {
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });

  // 1. Empty → suggested deeds.
  await page.goto(`${base}/deeds`);
  await page.locator("main button", { hasText: "Add 8 suggested deeds" }).waitFor({ timeout: 15_000 });
  await hydrated(page);
  await page.locator("main button", { hasText: "Add 8 suggested deeds" }).click();
  await page.locator("main ol > li").first().waitFor({ timeout: 15_000 });
  const seeded = await listTitles();
  check("8 suggested deeds added, in order, with Spanish titles",
    seeded.length === 8 && seeded[0] === STARTER_DEEDS[0]!.en && (await page.locator("main").innerText()).includes(STARTER_DEEDS[0]!.es));
  check("…audited", (await audits("deed_type.seed")) === 1);
  const again = await seedStarterDeeds(admin.id);
  check("suggestions are never added twice (only into an empty list)", !again.ok && again.error === "notEmpty" && (await DeedType.countDocuments()) === 8);

  // 2. Add: bad tip range refused (typing kept), then a good one lands at the end.
  await page.goto(`${base}/deeds/new`);
  await hydrated(page);
  await page.fill('[name="titleEn"]', `Walked a dog ${tag}`);
  await page.fill('[name="titleEs"]', `Paseé un perro ${tag}`);
  await page.fill('[name="tipMin"]', "20");
  await page.fill('[name="tipMax"]', "5");
  await page.locator("main button[type=submit]").click();
  await page.locator("main").getByText("must be at least the 'from' amount").waitFor({ timeout: 15_000 });
  check("min above max is refused, typed title kept", (await page.inputValue('[name="titleEn"]')) === `Walked a dog ${tag}` && (await DeedType.countDocuments()) === 8);
  await hydrated(page);
  await page.fill('[name="tipMax"]', "25");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((u) => u.pathname.endsWith("/deeds"), { timeout: 15_000 });
  await page.locator("main ol > li").nth(8).waitFor({ timeout: 15_000 });
  const added = await DeedType.findOne({ "title.en": `Walked a dog ${tag}` }).lean();
  check("new deed saved last, tips in cents", (await order()).at(-1) === `Walked a dog ${tag}` && added?.recommendedTipCents?.min === 2000 && added.recommendedTipCents.max === 2500);
  check("…audited", (await audits("deed_type.create")) === 1);

  // 3. Edit: change title, clear the tip range.
  await page.goto(`${base}/deeds/${added?._id}`);
  await hydrated(page);
  await page.fill('[name="titleEn"]', `Walked two dogs ${tag}`);
  await page.fill('[name="tipMin"]', "");
  await page.fill('[name="tipMax"]', "");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((u) => u.pathname.endsWith("/deeds"), { timeout: 15_000 });
  const edited = await DeedType.findById(added?._id).lean();
  check("edit saved; cleared tips removed", edited?.title.en === `Walked two dogs ${tag}` && edited.recommendedTipCents?.min == null && edited.recommendedTipCents?.max == null);
  check("…audited", (await audits("deed_type.update")) === 1);

  // 4. Reorder: move the new (last) deed up one place.
  await page.locator("main ol > li").nth(8).waitFor({ timeout: 15_000 });
  await hydrated(page);
  await page.locator(`main button[aria-label="Move Walked two dogs ${tag} up"]`).click();
  for (let i = 0; i < 30 && (await order()).at(-1) === `Walked two dogs ${tag}`; i++) await page.waitForTimeout(300);
  const o = await order();
  check("move up swaps it with the one above", o.at(-2) === `Walked two dogs ${tag}` && o.at(-1) === STARTER_DEEDS.at(-1)!.en);
  const sorts = (await DeedType.find().sort({ sortOrder: 1 }).lean()).map((d) => d.sortOrder);
  check("…and the list is renumbered cleanly (no ties)", new Set(sorts).size === sorts.length);

  // 5. Turn off / on.
  await page.goto(`${base}/deeds`);
  await hydrated(page);
  await page.locator(`main button[aria-label="Turn off ${STARTER_DEEDS[0]!.en}"]`).click();
  await page.locator("main").getByText("Off (hidden from families)").waitFor({ timeout: 15_000 });
  check("turn off → hidden from families (active false), audited",
    (await DeedType.findOne({ "title.en": STARTER_DEEDS[0]!.en }).lean())?.active === false && (await audits("deed_type.deactivate")) === 1);
  await hydrated(page);
  await page.locator(`main button[aria-label="Turn on ${STARTER_DEEDS[0]!.en}"]`).click();
  for (let i = 0; i < 30 && (await DeedType.findOne({ "title.en": STARTER_DEEDS[0]!.en }).lean())?.active === false; i++) await page.waitForTimeout(300);
  check("turn on again", (await DeedType.findOne({ "title.en": STARTER_DEEDS[0]!.en }).lean())?.active === true);

  // 6. Spanish.
  await page.goto(`${base}/es/deeds`);
  await page.locator("main h1").filter({ hasText: "Buenas acciones" }).waitFor({ timeout: 15_000 });
  check("Spanish page", true);

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  // Restore the catalog exactly as it was.
  await DeedType.collection.deleteMany({});
  if (backup.length) await DeedType.collection.insertMany(backup);
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await User.collection.deleteOne({ _id: new mongoose.Types.ObjectId(admin.id) });
  await mongoose.disconnect();
}
process.exit(report());
