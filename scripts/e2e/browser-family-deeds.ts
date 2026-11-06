/**
 * Real-browser E2E (Edge) for Phase 4 slice 3: recording deeds + single-use QR codes.
 *
 *   (from apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-deeds.ts http://localhost:3016
 *
 * Needs the season to be OPEN or FROZEN today (deeds are only recorded then); it stops early
 * with a clear message otherwise. Creates its own parents, kids and deed types (the real catalog
 * is untouched) and removes everything afterwards.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Deed, DeedType, Family, Kid, RateLimit, Season, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { hashDeedToken } from "@repo/deeds/qr";
import { getSeasonYear, resolveSeason } from "@repo/lib/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-deeds.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `deeds pass ${tag}`;
const PIN = "6284";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const phase = resolveSeason(new Date(), (await Season.findOne({ year: getSeasonYear() }).lean()) ?? {}).phase;
if (phase !== "open" && phase !== "frozen") throw new Error(`season is "${phase}" today: deeds can't be recorded (run during the season)`);

async function family(n: string) {
  const u = await User.create({ email: `e2e-deeds-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const f = await Family.create({ ownerUserId: u._id, familyName: `Deeds ${n}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date(), emailVerifiedAt: new Date() } });
  await User.updateOne({ _id: u._id }, { $set: { familyId: f._id } });
  return { user: u, family: f };
}
const A = await family("a");
const B = await family("b");
const reg = { status: "registered", registeredAt: new Date(), method: "card" };
const maya = await Kid.create({ familyId: A.family._id, firstName: "Maya", birthYear: 2017, displayName: "M.", registration: reg });
const leo = await Kid.create({ familyId: A.family._id, firstName: "Leo", birthYear: 2018, displayName: "L." });
const other = await Kid.create({ familyId: B.family._id, firstName: "Other", birthYear: 2016, displayName: "O.", registration: reg });
const typeOn = await DeedType.create({ title: { en: `Raked leaves ${tag}`, es: `Rastrillé hojas ${tag}` }, active: true, sortOrder: -1 });
const typeOff = await DeedType.create({ title: { en: `Retired deed ${tag}`, es: `Acción retirada ${tag}` }, active: false, sortOrder: -1 });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const mayaDeeds = () => Deed.find({ kidId: maya._id }).select("+qrTokenHash").sort({ createdAt: 1 }).lean();
async function record(choice: string, otherText?: string) {
  await page.goto(`${base}/kids/${maya._id}/deed`);
  await hydrated(page);
  if (choice === "other") {
    await page.check('main input[name="choice"][value="other"]');
    await page.locator('main [name="other"]').fill(otherText ?? "");
  } else {
    // Point the first radio at \`choice\` (lets the test post an id that isn't offered, too).
    await page.evaluate((v) => {
      const r = document.querySelector('main input[name="choice"]') as HTMLInputElement;
      r.value = v;
      r.checked = true;
    }, choice);
  }
  await page.evaluate(() => document.querySelectorAll("main [minlength]").forEach((e) => e.removeAttribute("minlength")));
  await page.locator("main button[type=submit]").click();
}

try {
  // Sign in + unlock the parent area.
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
  await page.goto(`${base}/parent/pin`);
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });

  // 1. Kid selector → kid page.
  await page.goto(`${base}/`);
  await page.locator(`main a[href$="/kids/${maya._id}"]`).waitFor({ timeout: 15_000 });
  check("kid selector links to each kid's page", true);

  // 2. Catalog deed → QR on the kid's page; DB keeps only the hash.
  await record(String(typeOn._id));
  await page.waitForURL((u) => u.pathname.endsWith(`/kids/${maya._id}`), { timeout: 15_000 });
  const qr = page.locator("main img[data-qr-url]").first();
  await qr.waitFor({ timeout: 15_000 });
  const url = (await qr.getAttribute("data-qr-url")) ?? "";
  const token = url.split("/d/")[1] ?? "";
  const [d1] = await mayaDeeds();
  const days = d1?.expiresAt ? (new Date(d1.expiresAt).getTime() - Date.now()) / 86_400_000 : 0;
  check("catalog deed → QR code on the kid's page (link /d/<token>)", url.startsWith(`${base}/d/`) && token.length === 43 && (await qr.getAttribute("src"))!.startsWith("data:image/png"));
  check("DB stores only the token's hash; pending; expires in 14 days",
    d1?.qrTokenHash === hashDeedToken(token) && !JSON.stringify(d1).includes(token) && d1?.status === "pending" && days > 13.9 && days <= 14);
  const audit = await AuditLog.findOne({ actorUserId: A.user._id, action: "deed.create" }).lean();
  check("recording is audited (ids only)", !!audit && !JSON.stringify(audit).includes("Raked"));
  check("same QR shown again on reload (token recomputed, not stored)", await (async () => {
    await page.reload();
    await page.locator("main img[data-qr-url]").first().waitFor({ timeout: 15_000 });
    return (await page.locator("main img[data-qr-url]").first().getAttribute("data-qr-url")) === url;
  })());

  // 3. "Other": too short refused; a real one → custom text, waiting for admin review.
  await record("other", "ok");
  await page.locator("main").getByText("Too short").waitFor({ timeout: 15_000 });
  check("'Other' needs at least 3 characters", (await mayaDeeds()).length === 1);
  await record("other", "Helped at the library");
  await page.waitForURL((u) => u.pathname.endsWith(`/kids/${maya._id}`), { timeout: 15_000 });
  const d2 = (await mayaDeeds())[1];
  check("'Other' deed saved with its text, waiting for admin approval before it's public", d2?.customDescription === "Helped at the library" && d2.customReview === "pending" && !d2.deedTypeId);

  // 4. An inactive (retired) deed type can't be used even if posted directly.
  await record(String(typeOff._id));
  await page.locator("main").getByText("isn't available any more").waitFor({ timeout: 15_000 });
  check("retired deed type refused", (await mayaDeeds()).length === 2);

  // 5. Unregistered kid: no deeds; other family's kid: not found.
  await page.goto(`${base}/kids/${leo._id}`);
  await page.locator("main").getByText("isn't registered yet").waitFor({ timeout: 15_000 });
  check("unregistered kid: explained, no 'Record' button", (await page.locator(`main a[href$="/kids/${leo._id}/deed"]`).count()) === 0);
  const res = await page.goto(`${base}/kids/${other._id}`);
  check("another family's kid page is not found", res?.status() === 404 || !(await page.locator("main").innerText()).includes("Other"));

  // 6. Daily cap.
  // The cap counts real deeds since midnight Chicago time: add 8 more for today (2 exist).
  await Deed.insertMany(Array.from({ length: 8 }, () => ({
    kidId: maya._id, familyId: A.family._id, seasonYear: getSeasonYear(), deedTypeId: typeOn._id, status: "pending",
    qrTokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 86_400_000),
  })));
  await record(String(typeOn._id));
  await page.locator("main").getByText("10 deeds today").waitFor({ timeout: 15_000 });
  check("10 deeds a day per child (counted from real deeds)", (await mayaDeeds()).length === 10);
  // Every still-usable QR is listed, not just the newest 20 (here: all 10 + their QR images).
  await page.goto(`${base}/kids/${maya._id}`);
  await page.locator("main img[data-qr-url]").first().waitFor({ timeout: 15_000 });
  check("all usable QR codes are shown", (await page.locator("main img[data-qr-url]").count()) === 10);

  // 7. PIN locked: the kid page (and its QR codes) still works, recording needs the PIN.
  await ctx.clearCookies({ name: /parent-unlock/ });
  await page.goto(`${base}/kids/${maya._id}`);
  await page.locator("main img[data-qr-url]").first().waitFor({ timeout: 15_000 });
  await page.goto(`${base}/kids/${maya._id}/deed`);
  await page.waitForURL(/\/parent\/pin/, { timeout: 15_000 });
  check("kids can open their page and QR codes without the PIN; recording needs it", true);

  // 8. Spanish.
  await page.goto(`${base}/es/kids/${maya._id}`);
  await page.locator("main").getByText("Buenas acciones").first().waitFor({ timeout: 15_000 });
  check("Spanish kid page shows the Spanish deed title", (await page.locator("main").innerText()).includes(`Rastrillé hojas ${tag}`));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const users = [A.user._id, B.user._id];
  const fams = [A.family._id, B.family._id];
  await Deed.collection.deleteMany({ familyId: { $in: fams } });
  await Kid.collection.deleteMany({ familyId: { $in: fams } });
  await DeedType.collection.deleteMany({ _id: { $in: [typeOn._id, typeOff._id] } });
  await AuditLog.collection.deleteMany({ actorUserId: { $in: users } });
  await RateLimit.collection.deleteMany({ key: trusted({ $in: [maya, leo, other].map((k) => `deed-create:${k._id}`) }) });
  await Family.collection.deleteMany({ _id: { $in: fams } });
  await User.collection.deleteMany({ _id: { $in: users } });
  await mongoose.disconnect();
}
process.exit(report());
