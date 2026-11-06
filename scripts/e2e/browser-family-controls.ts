/**
 * Real-browser E2E (Edge) for Phase 4 slice 5: parent controls (Naughty/Nice vote, wish-list item
 * limit, family nickname on QR pages).
 *
 *   (from apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-controls.ts http://localhost:3016
 *
 * Creates and removes its own parents, kids, votes and deeds in the *_dev DB.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Deed, Family, Kid, KidVote, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { deedToken, hashDeedToken } from "@repo/deeds/qr";
import { castVote } from "@repo/families/votes";
import { calendarDateIn, getSeasonYear, isoDay, santaListStart, santaListYear } from "@repo/lib/season";
import { reviewAlias } from "@repo/deeds/moderation";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-controls.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `controls pass ${tag}`;
const PIN = "7391";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
async function family(n: string) {
  const u = await User.create({ email: `e2e-ctl-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const f = await Family.create({ ownerUserId: u._id, familyName: `Realname${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
  await User.updateOne({ _id: u._id }, { $set: { familyId: f._id } });
  return { user: u, family: f };
}
const A = await family("a");
const B = await family("b");
const reg = { status: "registered", registeredAt: new Date(), method: "card" };
const maya = await Kid.create({ familyId: A.family._id, firstName: "Maya", birthYear: 2017, displayName: "M.", registration: reg });
// Registered two days ago (same time of day): today + 2 earlier days = 3 days counted, unless the
// current list (Dec 26 → Dec 25) started less than 3 days ago.
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
await Kid.collection.updateOne({ _id: maya._id }, { $set: { createdAt: twoDaysAgo, "registration.registeredAt": twoDaysAgo } });
const year = getSeasonYear();
const todayIso = isoDay(calendarDateIn(new Date()));
const listYear = santaListYear(todayIso);
const sinceListStart = Math.round((Date.parse(todayIso) - Date.parse(santaListStart(listYear))) / 86_400_000) + 1;
const expectDays = Math.min(3, sinceListStart);
// A naughty vote from LAST season must not count this year.
// Raw insert: the model refuses years before the first season (2026), but we need a past one.
await KidVote.collection.insertOne({ kidId: maya._id, familyId: A.family._id, seasonYear: listYear - 1, day: `${listYear - 2}-12-30`, vote: "naughty", createdAt: new Date(), updatedAt: new Date() });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const tally = () => page.locator(`[data-testid="tally-${maya._id}"]`).innerText();
async function vote(v: "Nice" | "Naughty") {
  await hydrated(page);
  await page.locator(`[role="group"][aria-label*="Maya"] button`, { hasText: new RegExp(`^${v}$`) }).click();
  await page.waitForFunction((label) => [...document.querySelectorAll('[role="group"] button')].some((b) => b.textContent === label && b.getAttribute("aria-pressed") === "true"), v);
}

try {
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

  // 1. No votes yet: every day counts as Nice (last season's vote ignored).
  await page.locator(`[data-testid="tally-${maya._id}"]`).waitFor({ timeout: 15_000 });
  check(`tally names the Christmas it counts toward (${listYear})`, (await tally()).includes(`Christmas ${listYear}`), await tally());
  check(`missed days count as Nice: ${expectDays} nice, 0 naughty (last list ignored)`, (await tally()).includes(`${expectDays} nice`) && (await tally()).includes("0 naughty"), await tally());

  // 2. Vote Naughty → tally changes; change to Nice the same day → still ONE vote.
  await vote("Naughty");
  check("Naughty today: one fewer nice day, 1 naughty", (await tally()).includes(`${expectDays - 1} nice`) && (await tally()).includes("1 naughty"), await tally());
  await vote("Nice");
  const todays = await KidVote.find({ kidId: maya._id, seasonYear: listYear }).lean();
  check("changing today's vote updates it (one vote per day)", todays.length === 1 && todays[0]!.vote === "nice" && (await tally()).includes("0 naughty"));

  // 3. The kid's own page shows the tally too.
  await page.goto(`${base}/kids/${maya._id}`);
  check("kid page shows this year's tally", (await page.locator('[data-testid="kid-tally"]').innerText()).includes(`${expectDays} nice`));

  // 4. Another family can't vote for this kid (service check).
  const foreign = await castVote({ id: String(B.user._id), familyId: String(B.family._id) }, String(maya._id), "naughty");
  check("another family's vote is refused", !foreign.ok && (await KidVote.countDocuments({ kidId: maya._id, seasonYear: listYear })) === 1);

  // 5. Item limit: 12 saved, 51 refused.
  await page.goto(`${base}/parent/kids/${maya._id}`);
  await hydrated(page);
  await page.fill('[name="itemCap"]', "12");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  check("item limit saved", (await Kid.findById(maya._id).lean())?.itemCap === 12);
  await page.goto(`${base}/parent/kids/${maya._id}`);
  await hydrated(page);
  await page.evaluate(() => document.querySelector('main [name="itemCap"]')?.removeAttribute("max"));
  await page.fill('[name="itemCap"]', "51");
  await page.locator("main button[type=submit]").click();
  await page.locator("main").getByText("from 0 to 50").waitFor({ timeout: 15_000 });
  check("item limit over 50 refused by the server", (await Kid.findById(maya._id).lean())?.itemCap === 12);

  // 6. Family nickname: shown on the QR page only while switched on; real name never.
  const _id = new mongoose.Types.ObjectId();
  const token = deedToken(String(_id));
  await Deed.collection.insertOne({ _id, kidId: maya._id, familyId: A.family._id, seasonYear: year, locale: "en", status: "pending", customDescription: "x", customReview: "pending", qrTokenHash: hashDeedToken(token), expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() });
  await page.goto(`${base}/parent`);
  await hydrated(page);
  await page.fill('[name="alias"]', "North Pole Helpers");
  await page.check('[name="show"]');
  await page.locator("main form", { has: page.locator('[name="alias"]') }).locator("button[type=submit]").click();
  await page.locator("main").getByText("Saved.").waitFor({ timeout: 15_000 });
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(`${base}/d/${token}`);
  await stranger.locator("main h1").waitFor({ timeout: 15_000 });
  check("a new nickname waits for admin review: not shown yet, parent told",
    !(await stranger.locator("main").innerText()).includes("North Pole Helpers") && (await page.locator("main").innerText()).includes("Waiting for a quick check"));
  const fakeAdmin = String(new mongoose.Types.ObjectId());
  await reviewAlias(fakeAdmin, String(A.family._id), "approved");
  await stranger.reload();
  await stranger.locator("main h1").waitFor({ timeout: 15_000 });
  const shown = await stranger.locator("main").innerText();
  check("approved + switched on → QR page says 'From the North Pole Helpers family', never the real name",
    shown.includes("North Pole Helpers") && !(await stranger.content()).includes(`Realname${tag}`));
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(fakeAdmin) });
  await hydrated(page);
  await page.uncheck('[name="show"]');
  await page.locator("main form", { has: page.locator('[name="alias"]') }).locator("button[type=submit]").click();
  await page.locator("main").getByText("Saved.").waitFor({ timeout: 15_000 });
  for (let i = 0; i < 20 && (await Family.findById(A.family._id).lean())?.showAliasPublicly; i++) await page.waitForTimeout(300);
  await stranger.reload();
  await stranger.locator("main h1").waitFor({ timeout: 15_000 });
  check("nickname switched off → not shown", !(await stranger.locator("main").innerText()).includes("North Pole Helpers"));
  check("nickname changes audited (no text in the log)",
    (await AuditLog.countDocuments({ actorUserId: A.user._id, action: "family.alias" })) === 2 && !JSON.stringify(await AuditLog.find({ actorUserId: A.user._id, action: "family.alias" }).lean()).includes("North Pole"));

  // 7. Deleting the kid deletes their votes too.
  await page.goto(`${base}/parent`);
  await hydrated(page);
  const row = page.locator("main li", { hasText: "Maya" });
  await row.locator('input[name="confirm"]').check();
  await row.locator("button", { hasText: "Delete child" }).click();
  for (let i = 0; i < 30 && (await Kid.exists({ _id: maya._id })); i++) await page.waitForTimeout(300);
  check("deleting a child deletes their votes", !(await Kid.exists({ _id: maya._id })) && (await KidVote.countDocuments({ kidId: maya._id })) === 0);

  // 8. Spanish.
  await page.goto(`${base}/es/parent`);
  await page.locator("main").getByText("Apodo familiar").waitFor({ timeout: 15_000 });
  check("Spanish parent controls", true);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const fams = [A.family._id, B.family._id];
  const users = [A.user._id, B.user._id];
  await KidVote.collection.deleteMany({ familyId: { $in: fams } });
  await Deed.collection.deleteMany({ familyId: { $in: fams } });
  await Kid.collection.deleteMany({ familyId: { $in: fams } });
  await AuditLog.collection.deleteMany({ actorUserId: { $in: users } });
  await Family.collection.deleteMany({ _id: { $in: fams } });
  await User.collection.deleteMany({ _id: { $in: users } });
  await mongoose.disconnect();
}
process.exit(report());
