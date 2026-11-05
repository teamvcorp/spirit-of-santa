/**
 * Real-browser E2E (Edge) for Phase 2 slice 2: admin approval queue, actions, invites and
 * invite acceptance in the store app. Runs against the DEV servers (admin :3002, store :3001)
 * so emails are printed to the dev log instead of sent.
 *
 *   npx turbo run dev --filter=store --filter=admin   (log to a file)
 *   $env:SEED_PASSWORD = "<dev password>"   (dev-admin@spiritofsanta.test, from npm run seed:dev)
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-stores.ts \
 *        http://localhost:3002 http://localhost:3001 <dev-log-file>
 *
 * Creates its own pending test stores in the *_dev DB and removes everything afterwards.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { ActionToken, AuditLog, connectDb, Store, trusted, User } from "@repo/db";
import { makeChecks, signIn } from "./lib.ts";

const [adminBase, storeBase, logFile] = process.argv.slice(2);
/**
 * --prod: run against PRODUCTION builds (next start). Production really sends email, so owner
 * addresses use Resend's test inbox, and checks that read emails from the dev log (plus the
 * invite acceptance, which needs the emailed link) are skipped.
 */
const PROD = process.argv.includes("--prod");
if (!adminBase || !storeBase || !logFile) throw new Error("usage: <adminUrl> <storeUrl> <devLog>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const ADMIN_PW = process.env.SEED_PASSWORD ?? "";
if (ADMIN_PW.length < 12) throw new Error("set SEED_PASSWORD (dev-admin password)");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mail = (n: string) => (PROD ? `delivered+adm${n}${tag}@resend.dev` : `e2e-adm-${n}-${tag}@spiritofsanta.test`);

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");

async function pendingStore(n: string, ownerStatus: "active" | "pending" = "active") {
  const user = await User.create({ email: mail(n), passwordHash: "x", role: "store_owner", status: ownerStatus, name: `Owner ${n}` });
  const store = await Store.create({
    name: `E2E ${n} Shop ${tag}`, slug: `e2e-${n}-${tag}`, category: "books", status: "pending", ownerUserId: user._id,
    contact: { email: mail(n), address: { line1: "1 Test", city: "Storm Lake", state: "IA", zip: "50588" } },
    discountAgreement: { version: "2026-11-05", acceptedAt: new Date(), acceptedByUserId: user._id },
  });
  await User.updateOne({ _id: user._id }, { $set: { storeId: store._id } });
  return String(store._id);
}
const storeA = await pendingStore("a");
const storeB = await pendingStore("b");
const storeC = await pendingStore("c", "pending"); // owner never confirmed their email
const inviteEmail = mail("inv");
class ProdDone extends Error {}

const log = () => (PROD ? "" : readFileSync(logFile, "utf8"));
const emailCount = (to: string, template: string) => log().split("[email:dev] to=").filter((b) => b.startsWith(`${to} template=${template}`)).length;
async function inviteLink(to: string): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const block = log().split("[email:dev] to=").filter((b) => b.startsWith(`${to} template=inviteOwner`)).at(-1);
    const link = block && /https?:\/\/\S+\/accept-invite\?token=[A-Za-z0-9_-]+/.exec(block)?.[0];
    if (link) return link;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const consoleErrors: string[] = [];
page.on("pageerror", (e) => consoleErrors.push(e.message));
const mainAlerts = async (p: Page) => (await p.locator('main [role="alert"], main [role="status"]').allInnerTexts()).join(" | ");
/** Content streamed in AND hydrated: at least one submit button, all enabled. (An empty list
 * would count as "all enabled" and let checks run before the page content arrives.) */
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('main button[type="submit"]')];
    return buttons.length > 0 && buttons.every((b) => !(b as HTMLButtonElement).disabled);
  });

try {
  // 0. Signed out: the queue doesn't show data.
  await page.goto(`${adminBase}/stores`);
  await page.waitForURL(/\/signin/, { timeout: 15_000 }).catch(() => {});
  check("signed-out visitor is sent to sign-in from /stores", page.url().includes("/signin"), page.url());

  // 1. Admin signs in.
  await page.goto(`${adminBase}/signin`);
  await ready(page);
  await page.fill('[name="email"]', "dev-admin@spiritofsanta.test");
  await page.fill('[name="password"]', ADMIN_PW);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
  await page.goto(`${adminBase}/`);
  await page.locator("main").getByText(/stores? waiting for review/).waitFor();
  check("dashboard shows the pending-stores count", true);

  // 2. Queue lists the pending test stores (oldest first).
  await page.goto(`${adminBase}/stores?status=pending`);
  await page.locator(`text=E2E a Shop ${tag}`).waitFor();
  check("pending queue lists the new stores", await page.locator(`text=E2E b Shop ${tag}`).isVisible());

  // 3. Approve store A with 17.5 %.
  await page.goto(`${adminBase}/stores/${storeA}`);
  await ready(page);
  const approveForm = page.locator("form", { hasText: "Approve this store" });
  await approveForm.locator('[name="discount"]').fill("17.5");
  await approveForm.locator('button[type="submit"]').click();
  await page.locator("main").getByText("Approved", { exact: true }).first().waitFor();
  const a = await Store.findById(storeA).lean();
  check("approve → store approved with discount 1750 bps", a?.status === "approved" && a.discountBps === 1750, `${a?.status} ${a?.discountBps}`);
  check("approval recorded in the audit log", !!(await AuditLog.exists({ targetId: a?._id, action: "store.approve" })));
  await page.waitForTimeout(500);
  if (!PROD) check("owner got a 'store approved' email", emailCount(mail("a"), "storeApproved") === 1);
  check("history on the page shows the approval", (await page.locator("main ol").innerText()).includes("Approved"));
  await page.locator("main [role=status]").getByText("Store approved").waitFor({ timeout: 10_000 }).catch(() => {});
  check("a visible confirmation stays after the page updates", (await mainAlerts(page)).includes("Store approved"));

  // 4. Suspend (reason required) → reinstate → change discount.
  await ready(page);
  const suspendForm = page.locator("form", { hasText: "Suspend this store" });
  await suspendForm.locator('[name="reason"]').fill("Prices not honoured (E2E)");
  await suspendForm.locator('button[type="submit"]').click();
  await page.locator("form", { hasText: "Reinstate this store" }).waitFor();
  check("suspend → suspended", (await Store.findById(storeA).lean())?.status === "suspended");
  await ready(page);
  await page.locator("form", { hasText: "Reinstate this store" }).locator('button[type="submit"]').click();
  await page.locator("form", { hasText: "Suspend this store" }).waitFor();
  check("reinstate → approved again", (await Store.findById(storeA).lean())?.status === "approved");
  await ready(page);
  const discountForm = page.locator("form", { hasText: "Change agreed discount" });
  await discountForm.locator('[name="discount"]').fill("20");
  await discountForm.locator('button[type="submit"]').click();
  await page.locator("main [role=status]").getByText("Discount saved.").waitFor();
  check("discount change saved + audited", (await Store.findById(storeA).lean())?.discountBps === 2000 && !!(await AuditLog.exists({ targetId: a?._id, action: "store.discount" })));
  await discountForm.locator('[name="discount"]').fill("95");
  await discountForm.locator('button[type="submit"]').click({ force: true }).catch(() => {});
  check("a 95% discount is refused (max 90%)", (await Store.findById(storeA).lean())?.discountBps === 2000);

  // 5. Reject store B with a reason; owner emailed with the reason.
  await page.goto(`${adminBase}/stores/${storeB}`);
  await ready(page);
  const rejectForm = page.locator("form", { hasText: "Don't approve" }).last();
  await rejectForm.locator('[name="reason"]').fill("Outside our service area (E2E)");
  await rejectForm.locator('button[type="submit"]').click();
  await page.locator("main").getByText("Not approved", { exact: true }).first().waitFor();
  const b = await Store.findById(storeB).lean();
  check("reject → rejected with the reason stored", b?.status === "rejected" && b.rejectionReason === "Outside our service area (E2E)");
  await page.waitForTimeout(500);
  const rejBlock = log().split("[email:dev] to=").filter((x) => x.startsWith(`${mail("b")} template=storeRejected`)).at(-1) ?? "";
  if (!PROD) check("owner got a 'not approved' email that includes the reason", rejBlock.includes("Outside our service area (E2E)"));

  // 5b. Review fixes: owner who never confirmed their email.
  await page.goto(`${adminBase}/stores/${storeC}`);
  await ready(page);
  check("unconfirmed owner: no Approve form, explanation shown instead",
    (await page.locator("form", { hasText: "Approve this store" }).count()) === 0 && (await page.locator("main").innerText()).includes("hasn't confirmed their email"));
  const rejectC = page.locator("form", { hasText: "Don't approve" }).last();
  await rejectC.locator('[name="reason"]').fill("Spam sign-up (E2E)");
  await rejectC.locator('button[type="submit"]').click();
  await page.locator("main").getByText("Not approved", { exact: true }).first().waitFor();
  await page.waitForTimeout(500);
  if (!PROD) check("rejecting it sends NO email to the unconfirmed address", emailCount(mail("c"), "storeRejected") === 0);
  // The daily purge must keep this owner: their store was rejected (no longer 'pending').
  await User.collection.updateOne({ email: mail("c") }, { $set: { createdAt: new Date(Date.now() - 72 * 3600e3) } });
  const { purgeUnverifiedStoreSignups } = await import("@repo/auth/account-flows");
  await purgeUnverifiedStoreSignups();
  check("purge keeps the owner of an already-reviewed store", !!(await User.exists({ email: mail("c") })) && !!(await Store.exists({ _id: storeC })));

  // 6. Stale page: another admin rejected B meanwhile → approving now says 'status changed'.
  //    (B is rejected; an approve is still allowed from rejected, so use a SUSPEND on B instead,
  //    which needs 'approved'.) Simulate via a second tab that loaded A, then change A's status.
  const tab2 = await browser.newPage();
  await tab2.context().addCookies(await page.context().cookies());
  await tab2.goto(`${adminBase}/stores/${storeA}`);
  await ready(tab2);
  await Store.updateOne({ _id: storeA }, { $set: { status: "suspended" } }); // changed behind the page's back
  const staleForm = tab2.locator("form", { hasText: "Suspend this store" });
  await staleForm.locator('[name="reason"]').fill("Second admin, stale page");
  await staleForm.locator('button[type="submit"]').click();
  await tab2.locator("main [role=alert]").first().waitFor();
  check("stale page action → 'status changed meanwhile', nothing overwritten",
    (await mainAlerts(tab2)).includes("status changed meanwhile") && (await Store.findById(storeA).lean())?.status === "suspended");
  await tab2.close();

  // 7. An admin action called WITHOUT an admin session does nothing.
  const adminSession = await signIn(adminBase, "dev-admin@spiritofsanta.test", ADMIN_PW);
  await Store.updateOne({ _id: storeB }, { $set: { status: "pending" } });
  // Read the page WITH the admin cookie (to get the Server Action id), then replay the
  // action WITHOUT any cookie, like an attacker who knows the action id would.
  const html = await (await fetch(`${adminBase}/stores/${storeB}`, { headers: { cookie: adminSession?.cookie ?? "" } })).text();
  const form = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]).find((f) => f.includes("Approve this store") || f.includes("$ACTION"));
  const fd = new FormData();
  for (const m of (form ?? "").matchAll(/<input[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    if (name && (name.startsWith("$ACTION") || /type="hidden"/.test(m[0]))) fd.append(name, (/value="([^"]*)"/.exec(m[0])?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  }
  fd.set("discount", "10");
  await fetch(`${adminBase}/stores/${storeB}`, { method: "POST", body: fd, headers: { origin: new URL(adminBase).origin }, redirect: "manual" });
  check("admin action replayed without a session changes nothing", !!form && (await Store.findById(storeB).lean())?.status === "pending");

  // 8. Invite a store; owner accepts in the store app.
  await page.goto(`${adminBase}/stores/invite`);
  await ready(page);
  await page.fill('[name="storeName"]', `E2E Invited ${tag}`);
  await page.fill('[name="ownerEmail"]', inviteEmail);
  await page.selectOption('[name="category"]', "toys");
  await page.fill('[name="discount"]', "15");
  await page.click('main button[type="submit"]');
  await page.locator("main").getByText("Invitation sent.").waitFor();
  const invited = await Store.findOne({ name: `E2E Invited ${tag}` }).lean();
  check("invite → store 'invited' with 15% and no owner yet", invited?.status === "invited" && invited.discountBps === 1500 && !invited.ownerUserId);
  if (PROD) { check("no browser errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || ")); throw new ProdDone(); }
  const link = await inviteLink(inviteEmail);
  check("invite email has an /accept-invite link to the store app", !!link && link.startsWith(storeBase));
  const dup = await page.goto(`${adminBase}/stores/invite`).then(async () => {
    await ready(page);
    await page.fill('[name="storeName"]', "Dup"); await page.fill('[name="ownerEmail"]', "dev-owner@spiritofsanta.test");
    await page.selectOption('[name="category"]', "toys"); await page.fill('[name="discount"]', "10");
    await page.click('main button[type="submit"]');
    await page.locator("main [role=alert]").first().waitFor();
    return mainAlerts(page);
  });
  check("inviting an email that already has an account is refused", dup.includes("already has an account"));

  // Duplicate invite for the same email is refused.
  await page.goto(`${adminBase}/stores/invite`);
  await ready(page);
  await page.fill('[name="storeName"]', "Second try"); await page.fill('[name="ownerEmail"]', inviteEmail);
  await page.selectOption('[name="category"]', "toys"); await page.fill('[name="discount"]', "15");
  await page.click('main button[type="submit"]');
  await page.locator("main [role=alert]").first().waitFor();
  check("a second invite to the same email is refused ('already has a pending invitation')", (await mainAlerts(page)).includes("pending invitation"));

  // Resend: new link works, the old one stops working.
  await page.goto(`${adminBase}/stores/${invited?._id}`);
  await ready(page);
  await page.locator("form", { hasText: "Resend the invitation" }).locator('button[type="submit"]').click();
  await page.locator("main").getByText("A new invitation was sent").waitFor();
  const oldLink = link!;
  let newLink: string | null = null;
  for (let i = 0; i < 20 && (!newLink || newLink === oldLink); i++) { newLink = await inviteLink(inviteEmail); await page.waitForTimeout(300); }
  check("resend issues a different link", !!newLink && newLink !== oldLink);
  const stale = await (await browser.newContext()).newPage();
  await stale.goto(oldLink);
  await stale.locator("main [role=alert]").waitFor();
  check("the old invitation link no longer works", (await mainAlerts(stale)).includes("expired or was already used"));
  await stale.close();

  // Squatter: someone self-signs-up with the invited email (unconfirmed) before the owner accepts.
  const squat = await User.create({ email: inviteEmail, passwordHash: "x", role: "store_owner", status: "pending" });
  await Store.create({ name: `Squatter ${tag}`, slug: `squat-${tag}`, category: "toys", status: "pending", ownerUserId: squat._id, contact: { email: inviteEmail } });

  const owner = await (await browser.newContext()).newPage();
  await owner.goto(newLink!);
  await owner.locator("main").getByText(`E2E Invited ${tag}`).waitFor();
  check("accept page shows the invited store's name", true);
  await ready(owner);
  await owner.fill('[name="ownerName"]', "Invited Owner");
  await owner.fill('[name="password"]', `invited pass ${tag}`);
  await owner.check('[name="agree"]');
  await owner.click('main button[type="submit"]');
  await owner.locator("main [role=status]").waitFor({ timeout: 20_000 });
  check("accepting shows 'you're all set'", (await mainAlerts(owner)).includes("all set"));
  const acc = await Store.findById(invited?._id).lean();
  const accUser = await User.findOne({ email: inviteEmail }).lean();
  check("store approved, owner active + linked, agreement recorded",
    acc?.status === "approved" && accUser?.status === "active" && String(acc?.ownerUserId) === String(accUser?._id) && !!acc?.discountAgreement?.acceptedAt);
  check("acceptance audited", !!(await AuditLog.exists({ targetId: invited?._id, action: "store.invite_accepted" })));
  check("invited owner can sign in to the store app", (await signIn(storeBase, inviteEmail, `invited pass ${tag}`))?.role === "store_owner");
  await owner.goto(link!);
  await owner.locator("main [role=alert]").waitFor();
  check("the invite link can't be used twice", (await mainAlerts(owner)).includes("expired or was already used"));
  check("the unconfirmed squatter account and its store were replaced",
    (await User.countDocuments({ email: inviteEmail })) === 1 && !(await Store.exists({ slug: `squat-${tag}` })) && !(await User.exists({ _id: squat._id })));

  // Cancel an invitation: the invited store disappears.
  await page.goto(`${adminBase}/stores/invite`);
  await ready(page);
  await page.fill('[name="storeName"]', `E2E Cancel ${tag}`); await page.fill('[name="ownerEmail"]', mail("cancel"));
  await page.selectOption('[name="category"]', "toys"); await page.fill('[name="discount"]', "10");
  await page.click('main button[type="submit"]');
  await page.locator("main").getByText("Invitation sent.").waitFor();
  const toCancel = await Store.findOne({ name: `E2E Cancel ${tag}` }).lean();
  await page.goto(`${adminBase}/stores/${toCancel?._id}`);
  await ready(page);
  await page.locator("form", { hasText: "Cancel the invitation" }).locator('button[type="submit"]').click();
  await page.waitForURL(/status=invited/, { timeout: 15_000 });
  check("cancel invitation → store deleted, back on the Invited tab", !(await Store.exists({ _id: toCancel?._id })));

  check("no browser errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
} catch (err) {
  if (err instanceof ProdDone) {
    /* --prod stops before the invite acceptance (see PROD) */
  } else {
    report();
    console.error("CRASHED:", err);
    await page.screenshot({ path: `${process.env.TEMP ?? "."}/e2e-admin-crash.png` }).catch(() => {});
    throw err;
  }
} finally {
  await browser.close();
  const stores = await Store.find({ name: trusted({ $regex: new RegExp(tag) }) }).select("_id").lean();
  const ids = stores.map((s) => s._id);
  await AuditLog.collection.deleteMany({ targetId: { $in: ids } });
  await Store.collection.deleteMany({ _id: { $in: ids } });
  const users = await User.find({ email: trusted({ $regex: new RegExp(`(-${tag}@spiritofsanta\\.test|${tag}@resend\\.dev)$`) }) }).select("_id").lean();
  await AuditLog.collection.deleteMany({ actorUserId: { $in: users.map((u) => u._id) } });
  await User.collection.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  await ActionToken.collection.deleteMany({ email: { $regex: new RegExp(`(-${tag}@spiritofsanta\\.test|${tag}@resend\\.dev)$`) } });
  await mongoose.disconnect();
}
process.exit(report());
