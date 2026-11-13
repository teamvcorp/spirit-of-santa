/**
 * E2E for NEWS + PARENTS (owner 2026-11-12, slice 2): the sign-up box, applied only after the email is confirmed;
 * the email-settings switch; "Our data"; account deletion removes the address from the list.
 *
 *   family dev server on :3000 (restart after model changes; dev PRINTS Resend contact calls), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-news-parent.ts http://localhost:3000
 *
 * *_dev database only; creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { ActionToken, connectDb, Family, NewsSubscription, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { createActionToken } from "@repo/auth/tokens";
import { setParentNews, syncPendingNews } from "@repo/auth/news";
import { eraseFamily } from "@repo/families/erase";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-news-parent.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `news pass ${tag}`;
const PIN = "8156";
const mailYes = `news-parent-${tag}@spiritofsanta.test`;
const mailNo = `news-noopt-${tag}@spiritofsanta.test`;
const mailGone = `news-gone-${tag}@spiritofsanta.test`;
const mailReset = `news-reset-${tag}@spiritofsanta.test`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");

/** A PENDING parent as /register makes it (optionally with the news tick). */
async function pendingParent(email: string, newsOptInAt?: Date) {
  const u = await User.create({ email, passwordHash: await hashSecret(PW), role: "parent", status: "pending", name: "Pat", ...(newsOptInAt ? { newsOptInAt } : {}) });
  const f = await Family.create({ ownerUserId: u._id, familyName: `News${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
  await User.updateOne({ _id: u._id }, { $set: { familyId: f._id } });
  return { u, f };
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const main = () => page.locator("main:visible");
async function confirmAccount(userId: unknown, email: string) {
  const { raw } = await createActionToken("verify_email", { email, userId: userId as never });
  await page.goto(`${base}/verify?token=${raw}`);
  await hydrated(page);
  await main().locator("button[type=submit]").click();
  await main().locator("[role=status]").first().waitFor({ timeout: 60_000 });
}

try {
  // 1. Sign-up form: the news box exists and is NOT pre-ticked.
  await page.goto(`${base}/register`);
  await page.locator('[data-testid="news-opt-in"]').waitFor({ timeout: 60_000 });
  check("sign-up: optional news box, not pre-ticked", !(await page.locator('[data-testid="news-opt-in"]').isChecked()));

  // 2. Ticked at sign-up → nothing on the list while pending; applied when the email is confirmed.
  const tickedAt = new Date(Date.now() - 60_000);
  const yes = await pendingParent(mailYes, tickedAt);
  check("pending parent with the tick: NOT on the list yet", !(await NewsSubscription.exists({ email: mailYes })));
  await confirmAccount(yes.u._id, mailYes);
  const row = await NewsSubscription.findOne({ email: mailYes }).lean();
  check("after confirming: subscribed, source parent, consent time = when they ticked, synced",
    row?.status === "subscribed" && row.source === "parent" && row.consentAt?.getTime() === tickedAt.getTime() && String(row.userId) === String(yes.u._id) && !!row.syncedAt);
  check("the pending wish is cleared (applied once)", !(await User.findById(yes.u._id).lean())?.newsOptInAt);

  // 3. No tick → confirming adds nothing.
  const no = await pendingParent(mailNo);
  const p2 = await (await browser.newContext()).newPage();
  const { raw: r2 } = await createActionToken("verify_email", { email: mailNo, userId: no.u._id });
  await p2.goto(`${base}/verify?token=${r2}`);
  await p2.waitForFunction(() => !(document.querySelector("main button[type=submit]") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 60_000 });
  await p2.locator("main button[type=submit]").click();
  await p2.locator("main [role=status]").first().waitFor({ timeout: 60_000 });
  check("no tick at sign-up → not on the list after confirming", !(await NewsSubscription.exists({ email: mailNo })));
  await p2.close();

  // 3b. Ticked at sign-up, but the account is activated by a PASSWORD RESET (review 2026-11-12): the tick applies
  //     then; a later explicit "off" wins even if the old confirm link is clicked afterwards.
  const reset = await pendingParent(mailReset, new Date());
  const oldVerify = await createActionToken("verify_email", { email: mailReset, userId: reset.u._id });
  const { raw: rr } = await createActionToken("reset_password", { email: mailReset, userId: reset.u._id });
  const p3 = await (await browser.newContext()).newPage();
  await p3.goto(`${base}/reset-password?token=${rr}`);
  await p3.waitForFunction(() => !(document.querySelector("main button[type=submit]") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 60_000 });
  await p3.fill('[name="password"]', `${PW} new`);
  await p3.locator("main button[type=submit]").click();
  await p3.locator("main [role=status]").first().waitFor({ timeout: 60_000 });
  check("activated by a password reset → the sign-up tick is applied", (await NewsSubscription.findOne({ email: mailReset }).lean())?.status === "subscribed");
  await setParentNews(String(reset.u._id), false);
  await p3.goto(`${base}/verify?token=${oldVerify.raw}`);
  await p3.waitForFunction(() => !(document.querySelector("main button[type=submit]") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 60_000 });
  await p3.locator("main button[type=submit]").click();
  await p3.locator("main [role]").first().waitFor({ timeout: 60_000 });
  check("old confirm link clicked after an explicit 'off' → stays off (newest choice wins)", (await NewsSubscription.findOne({ email: mailReset }).lean())?.status === "unsubscribed");
  await p3.close();

  // 4. Email settings (PIN): the news switch shows ON; switching it off unsubscribes; on again re-subscribes.
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', mailYes);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/parent/notifications`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent/notifications"), { timeout: 60_000 });
  const sw = main().locator('[data-testid="news-switch"]');
  await sw.waitFor({ timeout: 60_000 });
  check("settings: news switch shows ON for a subscribed parent", await sw.isChecked());
  await hydrated(page);
  await sw.uncheck();
  await main().getByRole("button", { name: "Save" }).click();
  await main().locator("[role=status]", { hasText: "Saved" }).waitFor({ timeout: 60_000 });
  const off = await NewsSubscription.findOne({ email: mailYes }).lean();
  check("switched off: unsubscribed + time kept as proof, synced", off?.status === "unsubscribed" && !!off.unsubscribedAt && !!off.syncedAt);
  await page.reload();
  await sw.waitFor({ timeout: 60_000 });
  check("settings show it OFF after reload", !(await sw.isChecked()));
  await hydrated(page);
  await sw.check();
  await main().getByRole("button", { name: "Save" }).click();
  await main().locator("[role=status]", { hasText: "Saved" }).waitFor({ timeout: 60_000 });
  const on = await NewsSubscription.findOne({ email: mailYes }).lean();
  check("switched on again: subscribed, new consent time, unsubscribedAt cleared",
    on?.status === "subscribed" && !on.unsubscribedAt && (on.consentAt?.getTime() ?? 0) > tickedAt.getTime() && (on.rev ?? 0) >= 3);

  // 5. "Our data" shows the news record.
  await page.goto(`${base}/parent/our-data`);
  await main().getByText("News emails").first().waitFor({ timeout: 60_000 });
  check("our data: news row says On", (await main().innerText()).includes("On (wording"));

  // 6. Account deletion: the address leaves the list (row + Resend contact).
  await eraseFamily({ id: String(yes.u._id), familyId: String(yes.f._id) }, { mode: "now" });
  check("account deleted → removed from the news list", !(await NewsSubscription.exists({ email: mailYes })));

  // 7. Deletion while Resend was down: the marked row is finished by the daily job.
  await NewsSubscription.create({ email: mailGone, status: "unsubscribed", source: "public", consentVersion: "t", consentAt: new Date(), confirmedAt: new Date(), forgetAt: new Date(), syncedAt: null });
  await syncPendingNews();
  check("a deletion Resend missed is finished by the daily job", !(await NewsSubscription.exists({ email: mailGone })));

  // 8. A row Resend refused 10 times is reported, not retried forever.
  await NewsSubscription.create({ email: mailGone, status: "subscribed", source: "public", consentVersion: "t", consentAt: new Date(), confirmedAt: new Date(), syncedAt: null, syncAttempts: 10, syncAttemptAt: new Date() });
  const r = await syncPendingNews();
  check("stuck row (10 failed tries) is reported, not retried", r.stuck >= 1 && (await NewsSubscription.findOne({ email: mailGone }).lean())?.syncAttempts === 10);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const mails = [mailYes, mailNo, mailGone, mailReset];
  const users = await User.find({ email: trusted({ $in: mails }) }).select("_id").lean();
  await Family.deleteMany({ ownerUserId: trusted({ $in: users.map((u) => u._id) }) });
  await User.deleteMany({ email: trusted({ $in: mails }) });
  await ActionToken.deleteMany({ email: trusted({ $in: mails }) });
  await NewsSubscription.deleteMany({ email: trusted({ $in: mails }) });
  await mongoose.disconnect();
}
process.exit(report());
