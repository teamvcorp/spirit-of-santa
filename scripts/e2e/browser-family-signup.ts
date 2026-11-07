/**
 * Real-browser E2E (Edge) for Phase 4 slice 1: parent sign-up with COPPA consent record.
 *
 *   npx turbo run build --filter=family
 *   (from apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-signup.ts http://localhost:3016
 *
 * Production SENDS email: sign-ups use Resend's test inbox (delivered+...@resend.dev). The
 * confirm link is made here with createActionToken (same kind of single-use token the email has).
 * Only *_dev databases; cleans up its users, families, tokens and sign-up rate-limit counters.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { ActionToken, connectDb, Family, RateLimit, trusted, User } from "@repo/db";
import { purgeUnverifiedParentSignups } from "@repo/auth/account-flows";
import { hashSecret } from "@repo/auth/password";
import { createActionToken } from "@repo/auth/tokens";
import { PARENT_CONSENT_VERSION } from "@repo/lib/family";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-signup.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const email = `delivered+fam${tag}@resend.dev`;
const PW = `family pass ${tag}`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function newPage() {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
async function fill(p: Page, mail: string, opts: { consent?: boolean; honeypot?: boolean } = {}) {
  await p.goto(`${base}/register`);
  await hydrated(p);
  await p.fill('[name="parentName"]', "Pat Parent");
  await p.fill('[name="email"]', mail);
  await p.fill('[name="password"]', PW);
  await p.fill('[name="familyName"]', `Testfamily ${tag}`);
  await p.fill('[name="zip"]', "50588");
  if (opts.consent !== false) await p.check('[name="consent"]');
  else await p.evaluate(() => document.querySelector('[name="consent"]')?.removeAttribute("required")); // test the SERVER check
  if (opts.honeypot) await p.evaluate(() => ((document.querySelector('[name="company_url"]') as HTMLInputElement).value = "http://spam.example"));
  await p.locator("main button[type=submit]").click();
}
async function signIn(p: Page) {
  await p.goto(`${base}/signin`);
  await hydrated(p);
  await p.fill('[name="email"]', email);
  await p.fill('[name="password"]', PW);
  await p.click("main button[type=submit]");
  return Promise.race([
    p.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 }).then(() => true),
    p.locator('main [role="alert"]').first().waitFor({ timeout: 15_000 }).then(() => false),
  ]).catch(() => false);
}

try {
  const page = await newPage();
  // 1. Privacy notice exists with the consent version (no DRAFT label since the owner removed it 2026-11-07).
  await page.goto(`${base}/privacy`);
  await page.locator("main h1").waitFor({ timeout: 15_000 });
  const privacy = await page.locator("main").innerText();
  check("privacy notice shows the consent version, no DRAFT label", !privacy.includes("DRAFT") && privacy.includes(PARENT_CONSENT_VERSION));
  await page.goto(`${base}/register`);
  check("consent box links to the privacy notice", (await page.locator('main a[href$="/privacy"]').count()) === 1);

  // 2. No consent → refused by the SERVER (browser check removed), typing kept.
  await fill(page, email, { consent: false });
  await page.locator("main").getByText("Please fix the fields").waitFor({ timeout: 15_000 });
  check("sign-up without consent is refused, typing kept", (await page.inputValue('[name="familyName"]')) === `Testfamily ${tag}` && !(await User.exists({ email })));

  // 3. Valid sign-up → pending parent + family with consent record.
  await fill(page, email);
  await page.locator("main").getByText("Check your email").waitFor({ timeout: 20_000 });
  const user = await User.findOne({ email }).lean();
  const fam = user ? await Family.findOne({ ownerUserId: user._id }).lean() : null;
  check("pending parent created and linked to a family", user?.role === "parent" && user.status === "pending" && String(user.familyId) === String(fam?._id));
  check("consent recorded: policy version + time, not yet email-verified",
    fam?.consent?.version === PARENT_CONSENT_VERSION && !!fam.consent.acceptedAt && !fam.consent.emailVerifiedAt && fam.zip === "50588");

  // 4. Can't sign in before confirming.
  const s1 = await newPage();
  check("sign-in refused until the email is confirmed", !(await signIn(s1)));

  // 5. Confirm (same kind of token as the email link) → active + consent.emailVerifiedAt.
  const { raw } = await createActionToken("verify_email", { email, userId: user!._id });
  await page.goto(`${base}/verify?token=${raw}`);
  await hydrated(page);
  await page.locator("main button[type=submit]").click();
  await page.locator("main [role=status]").first().waitFor({ timeout: 15_000 });
  const after = await User.findById(user!._id).lean();
  const famAfter = await Family.findById(fam!._id).lean();
  check("confirming activates the account and stamps consent.emailVerifiedAt", after?.status === "active" && !!famAfter?.consent?.emailVerifiedAt);
  const s2 = await newPage();
  check("signs in after confirming", await signIn(s2));

  // 6. No enumeration: signing up again with the same email gives the SAME answer, nothing new.
  const p2 = await newPage();
  await fill(p2, email);
  await p2.locator("main").getByText("Check your email").waitFor({ timeout: 20_000 });
  check("same email again: same 'check your email', no second family", (await Family.countDocuments({ ownerUserId: user!._id })) === 1 && (await User.countDocuments({ email })) === 1);

  // 7. Honeypot: looks like success, creates nothing.
  const botMail = `delivered+bot${tag}@resend.dev`;
  const p3 = await newPage();
  await fill(p3, botMail, { honeypot: true });
  await p3.locator("main").getByText("Check your email").waitFor({ timeout: 20_000 });
  check("bot (honeypot filled) gets the same answer, nothing created", !(await User.exists({ email: botMail })));

  // 8. Abandoned sign-ups (> 48 h, unconfirmed) are purged with their family; confirmed ones never.
  const old = await User.create({ email: `old-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "pending" });
  const oldFam = await Family.create({ ownerUserId: old._id, familyName: "Old", consent: { version: PARENT_CONSENT_VERSION, acceptedAt: new Date() } });
  await User.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 72 * 3_600_000) } });
  const purged = await purgeUnverifiedParentSignups();
  check("purge removes the old unconfirmed parent + family, keeps the confirmed one",
    purged.users >= 1 && !(await User.exists({ _id: old._id })) && !(await Family.exists({ _id: oldFam._id })) && !!(await User.exists({ _id: user!._id })));

  // 9. Spanish.
  await page.goto(`${base}/es/register`);
  await page.locator("main h1").filter({ hasText: "Crea tu cuenta familiar" }).waitFor({ timeout: 15_000 });
  check("Spanish sign-up page", true);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const users = await User.find({ email: trusted({ $regex: `${tag}@` }) }).select("_id").lean();
  const ids = users.map((u) => u._id);
  await Family.collection.deleteMany({ ownerUserId: { $in: ids } });
  await ActionToken.collection.deleteMany({ userId: { $in: ids } });
  await User.collection.deleteMany({ _id: { $in: ids } });
  await RateLimit.collection.deleteMany({ key: { $regex: "^register-parent:" } });
  await mongoose.disconnect();
}
process.exit(report());
