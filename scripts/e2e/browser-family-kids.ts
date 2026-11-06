/**
 * Real-browser E2E (Edge) for Phase 4 slice 2a: kids, parent PIN, parent area.
 *
 *   (from apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-kids.ts http://localhost:3016
 *
 * Creates its own (already confirmed) parents + families in the *_dev DB; removes everything after.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Deed, Family, Kid, RateLimit, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { MAX_KIDS_PER_FAMILY } from "@repo/lib/limits";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-kids.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `kids pass ${tag}`;
const PIN = "4826";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
async function parent(n: string) {
  const u = await User.create({ email: `e2e-kids-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const f = await Family.create({ ownerUserId: u._id, familyName: `Kids ${n}`, consent: { version: "test", acceptedAt: new Date(), emailVerifiedAt: new Date() } });
  await User.updateOne({ _id: u._id }, { $set: { familyId: f._id } });
  return { user: u, family: f };
}
const A = await parent("a");
const B = await parent("b");
const otherKid = await Kid.create({ familyId: B.family._id, firstName: "Other", birthYear: 2017, displayName: "O." });

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
const alert = (text: string) => page.locator('main [role="alert"]').filter({ hasText: text }).first().waitFor({ timeout: 15_000 });
const kidsOfA = () => Kid.find({ familyId: A.family._id }).sort({ createdAt: 1 }).lean();
const audits = (action: string) => AuditLog.find({ actorUserId: A.user._id, action }).lean();

async function addKid(first: string, year: string, display = "") {
  await page.goto(`${base}/parent/kids/new`);
  await hydrated(page);
  await page.fill('[name="firstName"]', first);
  await page.fill('[name="birthYear"]', year);
  await page.fill('[name="displayName"]', display);
  // Remove the browser's own min/max so the SERVER check is what's tested.
  await page.evaluate(() => document.querySelectorAll("main [name=birthYear]").forEach((e) => (e.removeAttribute("min"), e.removeAttribute("max"))));
  await page.locator("main button[type=submit]").click();
}

try {
  // 1. Sign in; empty selector; parent area asks for a PIN first.
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
  await page.goto(`${base}/`);
  await page.locator("main").getByText("No children added yet").waitFor({ timeout: 15_000 });
  check("home shows the (empty) kid selector for a signed-in parent", true);
  await page.goto(`${base}/parent`);
  await page.waitForURL(/\/parent\/pin\/setup/, { timeout: 15_000 });
  check("no PIN yet → parent area sends you to set one", true);

  // 2. PIN setup needs the account password; PINs must match.
  await hydrated(page);
  await page.fill('[name="password"]', "wrong password!!");
  await page.fill('[name="pin"]', PIN);
  await page.fill('[name="pinConfirm"]', PIN);
  await page.locator("main button[type=submit]").click();
  await alert("password isn't right");
  const failed = await User.findById(A.user._id).select("+failedLoginCount").lean();
  check("wrong account password → PIN not set, and it counts toward the sign-in lockout",
    !(await Family.findById(A.family._id).select("+parentPinHash").lean())?.parentPinHash && failed?.failedLoginCount === 1);
  await hydrated(page);
  await page.fill('[name="password"]', PW);
  await page.fill('[name="pin"]', PIN);
  await page.fill('[name="pinConfirm"]', "9999");
  await page.locator("main button[type=submit]").click();
  await page.locator("main").getByText("don't match").waitFor({ timeout: 15_000 });
  check("mismatched PINs refused", true);
  await hydrated(page);
  await page.fill('[name="password"]', PW);
  await page.fill('[name="pin"]', PIN);
  await page.fill('[name="pinConfirm"]', PIN);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  const fam = await Family.findById(A.family._id).select("+parentPinHash").lean();
  check("PIN set (hashed, not stored as typed), parent area unlocked, audited",
    !!fam?.parentPinHash && !fam.parentPinHash.includes(PIN) && (await audits("family.pin_set")).length === 1);

  // 3. Add kids: bad year refused (typing kept); blank display name → first initial.
  await addKid("Maya", "2005");
  await page.locator("main").getByText("must be under 18").waitFor({ timeout: 15_000 });
  check("a birth year making them 18+ is refused, typing kept", (await page.inputValue('[name="firstName"]')) === "Maya" && (await kidsOfA()).length === 0);
  await hydrated(page);
  await page.fill('[name="birthYear"]', "2018");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  await addKid("Leo", "2016", "Star Helper");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  const kids = await kidsOfA();
  check("kids saved: birth YEAR only, display name defaults to the initial, awaiting registration",
    kids.length === 2 && kids[0]!.birthYear === 2018 && kids[0]!.displayName === "M." && kids[1]!.displayName === "Star Helper" &&
      kids.every((k) => k.registration?.status === "awaiting") && !("birthDate" in kids[0]!));
  const addAudits = await audits("kid.add");
  check("adds audited WITHOUT the child's name", addAudits.length === 2 && !JSON.stringify(addAudits).includes("Maya"));

  // 4. Kid selector shows them (first names on the family's own device) with the badge.
  await page.goto(`${base}/`);
  const sel = await page.locator('[data-testid="kid-selector"]').innerText();
  check("kid selector lists the kids with 'Awaiting registration'", sel.includes("Maya") && sel.includes("Leo") && sel.includes("Awaiting registration"));

  // 5. Edit.
  await page.goto(`${base}/parent/kids/${kids[0]!._id}`);
  await hydrated(page);
  await page.fill('[name="displayName"]', "Maya B.");
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  check("edit saved", (await Kid.findById(kids[0]!._id).lean())?.displayName === "Maya B.");

  // 6. Another family's kid is not found.
  const res = await page.goto(`${base}/parent/kids/${otherKid._id}`);
  check("another family's child is not found", res?.status() === 404 || !(await page.locator("main").innerText()).includes("Other"));

  // 7. PIN lock expires mid-form → the SERVER refuses the change.
  await page.goto(`${base}/parent/kids/new`);
  await hydrated(page);
  await ctx.clearCookies({ name: /parent-unlock/ });
  await page.fill('[name="firstName"]', "Sneaky");
  await page.fill('[name="birthYear"]', "2019");
  await page.locator("main button[type=submit]").click();
  await alert("locked itself");
  check("adding a kid without the PIN unlock is refused by the server", (await kidsOfA()).length === 2);

  // 8. Locked: /parent asks for the PIN; wrong PIN refused; right PIN unlocks.
  await page.goto(`${base}/parent`);
  await page.waitForURL(/\/parent\/pin$/, { timeout: 15_000 });
  await hydrated(page);
  await page.fill('[name="pin"]', "0000");
  await page.locator("main button[type=submit]").click();
  await alert("PIN didn't work");
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.locator("main button[type=submit]").click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  check("wrong PIN refused, right PIN unlocks", true);

  // 9. Delete (needs the tick) = really gone with their deeds + wish-list rows, audited.
  const oid = () => new mongoose.Types.ObjectId();
  await Deed.collection.insertOne({ kidId: kids[1]!._id, familyId: A.family._id, customDescription: "Helped grandma", status: "pending", qrTokenHash: `e2e-${tag}`, createdAt: new Date() });
  await WishListItem.collection.insertOne({ kidId: kids[1]!._id, familyId: A.family._id, itemId: oid(), storeId: oid(), seasonYear: 2026, costCentipoints: 100, fundedCentipoints: 0, status: "active" });
  await hydrated(page);
  const row = page.locator("main li", { hasText: "Leo" });
  await row.locator('input[name="confirm"]').check();
  await row.locator("button", { hasText: "Delete child" }).click();
  for (let i = 0; i < 30 && (await Kid.exists({ _id: kids[1]!._id })); i++) await page.waitForTimeout(300);
  check("delete really removes the child's record, deeds and wish-list rows, audited",
    !(await Kid.exists({ _id: kids[1]!._id })) && (await Deed.countDocuments({ kidId: kids[1]!._id })) === 0 &&
      (await WishListItem.countDocuments({ kidId: kids[1]!._id })) === 0 && (await audits("kid.delete")).length === 1);

  // 10. Family limit.
  await Kid.insertMany(Array.from({ length: MAX_KIDS_PER_FAMILY - 1 }, (_, i) => ({ familyId: A.family._id, firstName: `Fill${i}`, birthYear: 2015, displayName: "F." })));
  await addKid("Eleven", "2019");
  await alert("up to 10 children");
  check(`the ${MAX_KIDS_PER_FAMILY}-child limit holds`, (await Kid.countDocuments({ familyId: A.family._id })) === MAX_KIDS_PER_FAMILY);

  // 11. Spanish.
  await page.goto(`${base}/es/parent`);
  await page.locator("main h1").filter({ hasText: "Área de padres" }).waitFor({ timeout: 15_000 });
  check("Spanish parent area", true);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const users = [A.user._id, B.user._id];
  const fams = [A.family._id, B.family._id];
  await Kid.collection.deleteMany({ familyId: { $in: fams } });
  await Deed.collection.deleteMany({ familyId: { $in: fams } });
  await WishListItem.collection.deleteMany({ familyId: { $in: fams } });
  await AuditLog.collection.deleteMany({ actorUserId: { $in: users } });
  await RateLimit.collection.deleteMany({ key: trusted({ $in: users.map((u) => `pin-set:${u}`) }) });
  await Family.collection.deleteMany({ _id: { $in: fams } });
  await User.collection.deleteMany({ _id: { $in: users } });
  await mongoose.disconnect();
}
process.exit(report());
