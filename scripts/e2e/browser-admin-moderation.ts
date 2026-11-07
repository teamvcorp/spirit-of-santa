/**
 * Phase 8 moderation workflow test (Edge): everything parents type that strangers can see goes through the admin
 * queue first. Covers what browser-qr-page.ts doesn't: family NICKNAMES end to end in the admin UI, unsafe markup,
 * stale/double reviews, and who can open the queue.
 *  1. A stranger (no session) is sent to sign-in, never shown the queue.
 *  2. A pending nickname and a pending "Other" deed text both appear in /moderation; markup in them is shown as
 *     plain text (no HTML/script runs) and no child or family surname appears.
 *  3. Nickname "Hide" → never public on the QR page; another nickname "Approve" → shown; both audited.
 *  4. Reviewing the same item again (stale page / double click) changes nothing.
 *  5. A pending deed text is NOT on the public page until approved ("A good deed" meanwhile).
 *
 *   family :3000 + admin :3002 dev servers, then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *        scripts/e2e/browser-admin-moderation.ts http://localhost:3000 http://localhost:3002
 * Needs the season open or frozen. *_dev database only. Creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Deed, Family, Kid, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { deedToken, hashDeedToken } from "@repo/deeds/qr";
import { reviewAlias } from "@repo/deeds/moderation";
import { getSeasonYear } from "@repo/lib/season";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [family, adminBase] = process.argv.slice(2);
if (!family || !adminBase) throw new Error("usage: browser-admin-moderation.ts <familyUrl> <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const year = getSeasonYear();
const XSS = `<img src=x onerror="window.__pwned=1">Elves${tag}`;

async function mkFamily(n: string, alias: string) {
  const user = await User.create({ email: `e2e-mod-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(`mod ${tag}`), role: "parent", status: "active" });
  const fam = await Family.create({ ownerUserId: user._id, familyName: `Surname${n}${tag}`, alias, showAliasPublicly: true, aliasReview: "pending", consent: { version: "test", acceptedAt: new Date() } });
  const kid = await Kid.create({ familyId: fam._id, firstName: `Kidfirst${n}${tag}`, birthYear: 2017, displayName: "K.", registration: { status: "registered", registeredAt: new Date(), method: "card" } });
  const _id = new mongoose.Types.ObjectId();
  const token = deedToken(String(_id));
  await Deed.collection.insertOne({ _id, kidId: kid._id, familyId: fam._id, seasonYear: year, locale: "en", status: "pending", qrTokenHash: hashDeedToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000), customDescription: `Shoveled snow ${n}${tag}`, customReview: "pending", createdAt: new Date(), updatedAt: new Date() });
  return { user, fam, kid, deedId: _id, token };
}
const A = await mkFamily("a", XSS); // will be HIDDEN
const B = await mkFamily("b", `Snowmen${tag}`); // will be APPROVED
const admin = await createMfaAdmin(`e2e-mod-admin-${tag}@spiritofsanta.test`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const waitFor = async (cond: () => Promise<boolean>) => {
  for (let i = 0; i < 40 && !(await cond()); i++) await page.waitForTimeout(300);
};
const publicDeed = async (token: string) => {
  const p = await ctx.newPage();
  await p.goto(`${family}/d/${token}`);
  await p.locator("main h1").first().waitFor({ timeout: 60_000 });
  const text = await p.locator("main").innerText();
  await p.close();
  return text;
};

try {
  // 1. No session: never the queue.
  await page.goto(`${adminBase}/moderation`);
  await page.waitForURL((u) => u.pathname.includes("signin"), { timeout: 60_000 });
  check("stranger is sent to sign-in (queue not shown)", !(await page.content()).includes(`Shoveled snow`));

  // Before any review: neither nickname nor text is public.
  const before = await publicDeed(A.token);
  check("pending nickname and pending text are NOT public yet", !before.includes(`Elves${tag}`) && !before.includes("Shoveled snow") && before.includes("A good deed"));

  // Admin signs in (password + authenticator code).
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });

  // 2. Queue: both kinds, markup shown as text, no child/surname.
  await page.goto(`${adminBase}/moderation`);
  const aliases = page.locator('[data-testid="alias-list"]');
  await aliases.waitFor({ timeout: 60_000 });
  const aliasText = await aliases.innerText();
  const textList = await page.locator('[data-testid="moderation-list"]').innerText();
  check("queue lists both pending nicknames and both pending deed texts", aliasText.includes(`Snowmen${tag}`) && aliasText.includes(`Elves${tag}`) && textList.includes(`Shoveled snow a${tag}`) && textList.includes(`Shoveled snow b${tag}`));
  check("markup in a nickname is shown as plain text and never runs", aliasText.includes(`<img src=x`) && !(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)));
  const whole = await page.content();
  check("queue shows no child first name or family surname", !whole.includes(`Kidfirsta${tag}`) && !whole.includes(`Surnamea${tag}`));

  // 3. Hide A's nickname, approve B's.
  await hydrated(page);
  await page.locator('[data-testid="alias-list"] li', { hasText: `Elves${tag}` }).locator("button", { hasText: "Hide" }).click();
  await waitFor(async () => (await Family.findById(A.fam._id).lean())?.aliasReview === "rejected");
  await hydrated(page);
  await page.locator('[data-testid="alias-list"] li', { hasText: `Snowmen${tag}` }).locator("button", { hasText: "Approve" }).click();
  await waitFor(async () => (await Family.findById(B.fam._id).lean())?.aliasReview === "approved");
  const fa = await Family.findById(A.fam._id).lean();
  const fb = await Family.findById(B.fam._id).lean();
  check("nickname decisions saved (A hidden, B approved)", fa?.aliasReview === "rejected" && fb?.aliasReview === "approved");
  check("both nickname reviews are audited", (await AuditLog.countDocuments({ actorUserId: new mongoose.Types.ObjectId(admin.id), targetId: trusted({ $in: [A.fam._id, B.fam._id] }) })) >= 2);
  const pa = await publicDeed(A.token);
  const pb = await publicDeed(B.token);
  check("hidden nickname never appears publicly; approved one does", !pa.includes(`Elves${tag}`) && pb.includes(`Snowmen${tag}`));

  // 4. Reviewing again (stale page / second admin) changes nothing.
  const again = await reviewAlias(admin.id, String(A.fam._id), "approved");
  check("a second review of an already-reviewed nickname is refused and changes nothing", !again.ok && (await Family.findById(A.fam._id).lean())?.aliasReview === "rejected");

  // 5. Deed texts: still pending → not public; approve B's → public.
  check("pending deed text still not public", !(await publicDeed(B.token)).includes("Shoveled snow"));
  await page.goto(`${adminBase}/moderation`);
  await hydrated(page);
  await page.locator('[data-testid="moderation-list"] li', { hasText: `Shoveled snow b${tag}` }).locator("button", { hasText: "Approve" }).click();
  await waitFor(async () => (await Deed.findById(B.deedId).lean())?.customReview === "approved");
  check("approved deed text appears on the public page", (await publicDeed(B.token)).includes(`Shoveled snow b${tag}`));

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const fams = [A.fam._id, B.fam._id];
  await Deed.collection.deleteMany({ familyId: { $in: fams } });
  await Kid.collection.deleteMany({ familyId: { $in: fams } });
  await Family.collection.deleteMany({ _id: { $in: fams } });
  await User.collection.deleteMany({ _id: { $in: [A.user._id, B.user._id, new mongoose.Types.ObjectId(admin.id)] } });
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await mongoose.disconnect();
}
process.exit(report());

