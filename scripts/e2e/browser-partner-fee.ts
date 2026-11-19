/**
 * Real-browser E2E (Edge) for the FOUNDING PARTNER FEE (owner 2026-11-18, founding-partners slice 2).
 *
 *   admin :3002, store :3001, family dev servers running (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-partner-fee.ts \
 *        http://localhost:3002 http://localhost:3001 http://localhost:3000 <admin-dev-log-file>
 *
 * Proves: fee set on a not-yet-live store (invoice emailed, audited); approval REFUSED while due; the store shows as
 * Processing on the public partners page; the owner sees the fee + an invoice that is a business document (never
 * donation / tax wording); a future payment date is refused; marking paid records it (receipt emailed) and approval
 * then works; an invited store with a fee due joins as "pending", not approved; waive + clear; a fee can never be
 * set on an already-live store; partner-fee income shows apart from donations. *_dev database only.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import mongooseLib from "mongoose";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Store, User } from "@repo/db";
import { acceptStoreInvite } from "@repo/auth/account-flows";
import { hashSecret } from "@repo/auth/password";
import { createActionToken } from "@repo/auth/tokens";
import { getSeasonYear } from "@repo/lib/season";
import { clearPartnerFee, partnerFeesReceived, setPartnerFee, waivePartnerFee } from "@repo/stores/partner-fee";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [adminBase, storeBase, familyBase, adminLog] = process.argv.slice(2);
if (!adminBase || !storeBase || !familyBase || !adminLog) throw new Error("usage: <adminUrl> <storeUrl> <familyUrl> <adminDevLog>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `fee pass ${tag} long enough`;
const oid = () => new mongooseLib.Types.ObjectId();
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const logStart = readFileSync(adminLog, "utf8").length;

// A store that signed itself up (pending, owner confirmed), one live store, one still invited.
const owner = await User.create({ email: `e2e-fee-owner-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "store_owner", status: "active", locale: "en" });
const now = new Date();
const ids = { pend: oid(), live: oid(), inv: oid(), clr: oid() };
await Store.collection.insertMany([
  { _id: ids.pend, name: `Fee Pending ${tag}`, slug: `e2e-fee-p-${tag}`, category: "toys", status: "pending", ownerUserId: owner._id, discountBps: 1500, contact: { email: owner.email }, createdAt: now, updatedAt: now },
  { _id: ids.live, name: `Fee Live ${tag}`, slug: `e2e-fee-l-${tag}`, category: "toys", status: "approved", ownerUserId: oid(), createdAt: now, updatedAt: now },
  { _id: ids.inv, name: `Fee Invited ${tag}`, slug: `e2e-fee-i-${tag}`, category: "toys", status: "invited", discountBps: 1000, contact: { email: `e2e-fee-inv-${tag}@spiritofsanta.test` }, createdAt: now, updatedAt: now },
  { _id: ids.clr, name: `Fee Clear ${tag}`, slug: `e2e-fee-c-${tag}`, category: "toys", status: "invited", contact: { email: `e2e-fee-clr-${tag}@spiritofsanta.test` }, createdAt: now, updatedAt: now },
]);
await User.updateOne({ _id: owner._id }, { $set: { storeId: ids.pend } });
const admin = await createMfaAdmin(`e2e-fee-admin-${tag}@spiritofsanta.test`);
const adminActor = { id: admin.id, role: "admin" };
const extraUsers: mongooseLib.Types.ObjectId[] = [owner._id];
const feesBefore = await partnerFeesReceived(getSeasonYear(now));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const newPage = async () => {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
};
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const fee = async (id: mongooseLib.Types.ObjectId) => (await Store.findById(id).lean())?.partnerFee;
/** Submit one of the ActionForms on the admin store page (by its heading) and return its alert/notice text. */
async function submitCard(p: Page, heading: string, fill?: () => Promise<void>) {
  await hydrated(p);
  const form = p.locator("main:visible form", { has: p.getByRole("heading", { name: heading, exact: true }) });
  await fill?.();
  await p.evaluate(() => document.querySelectorAll("main [role=status] > *, main form [role=alert]").forEach((n) => n.remove()));
  await form.locator('button[type="submit"]').click();
  const out = p.locator("main:visible [role=status] [role=status], main:visible [role=status] div, main:visible form [role=alert]").first();
  await out.waitFor({ timeout: 60_000 });
  return out.innerText();
}

try {
  // ── Admin signs in.
  const ap = await newPage();
  await ap.goto(`${adminBase}/signin`);
  await hydrated(ap);
  await ap.fill('[name="email"]', admin.email);
  await ap.fill('[name="password"]', admin.password);
  await ap.fill('[name="code"]', await admin.nextCode());
  await ap.click("main:visible button[type=submit]");
  await ap.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });

  // 1. Set the fee on the pending store: due, invoice number, audited.
  await ap.goto(`${adminBase}/stores/${ids.pend}`);
  await ap.locator('main:visible [data-testid="partner-fee"]').waitFor({ timeout: 60_000 });
  check("store page shows the fee card ('No fee' at first)", (await ap.locator('main:visible [data-testid="fee-status"]').innerText()).includes("No fee"));
  const setMsg = await submitCard(ap, "Require the partner fee", async () => ap.fill('main:visible [name="amount"]', "50,000"));
  const f1 = await fee(ids.pend);
  check("fee set: due $50,000, invoice number, audited", setMsg.includes("Saved") && f1?.status === "due" && f1.amountCents === 5_000_000 && /^FP-[0-9A-F]{12}$/.test(f1.invoiceNo ?? "") && !!(await AuditLog.exists({ targetId: ids.pend, action: "store.fee_set" })), setMsg);

  // 2. Approval is refused while the fee is due (server rule, not just the UI).
  await ap.goto(`${adminBase}/stores/${ids.pend}`);
  const approveMsg = await submitCard(ap, "Approve this store");
  check("approve refused while the fee is due; store stays pending", approveMsg.includes("still due") && (await Store.findById(ids.pend).lean())?.status === "pending", approveMsg);

  // 3. Public partners page: listed as Processing (owner confirmed), never Approved.
  const fam = await newPage();
  await fam.goto(`${familyBase}/partners`);
  await fam.locator(`main:visible [data-slug="e2e-fee-p-${tag}"]`).waitFor({ timeout: 60_000 });
  check("partners page: fee-due store shows as Processing", (await fam.locator(`main:visible [data-slug="e2e-fee-p-${tag}"]`).getAttribute("data-status")) === "processing");

  // 4. The owner sees the fee and a BUSINESS invoice.
  const sp = await newPage();
  await sp.goto(`${storeBase}/signin`);
  await hydrated(sp);
  await sp.fill('[name="email"]', owner.email);
  await sp.fill('[name="password"]', PW);
  await sp.click("main:visible button[type=submit]");
  await sp.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await sp.goto(`${storeBase}/dashboard`);
  await sp.locator('main:visible [data-testid="fee-card"]').waitFor({ timeout: 60_000 });
  check("owner dashboard: 'Due: $50,000.00'", (await sp.locator('main:visible [data-testid="fee-card-status"]').innerText()).includes("Due: $50,000.00"));
  await sp.goto(`${storeBase}/dashboard/partner-fee`);
  await sp.locator('main:visible [data-testid="fee-invoice"]').waitFor({ timeout: 60_000 });
  const invoice = await sp.locator('main:visible [data-testid="fee-invoice"]').innerText();
  check("owner's invoice: number, amount, 'not a donation', non-refundable", invoice.includes(f1?.invoiceNo ?? "?") && invoice.includes("$50,000.00") && invoice.includes("not a donation") && invoice.includes("non-refundable"));
  check("invoice has NO tax / donation-receipt wording", !/tax|deductib|goods or services/i.test(invoice));

  // 5. Mark paid: a future date is refused by the server; then a real payment.
  await ap.goto(`${adminBase}/stores/${ids.pend}`);
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const futureMsg = await submitCard(ap, "Record the payment", async () => {
    await ap.evaluate(() => document.querySelector('main [name="paidOn"]')?.removeAttribute("max"));
    await ap.fill('main:visible [name="paidOn"]', future);
  });
  check("a payment dated in the future is refused", futureMsg.includes("isn't valid") && (await fee(ids.pend))?.status === "due", futureMsg);
  await ap.goto(`${adminBase}/stores/${ids.pend}`);
  const paidMsg = await submitCard(ap, "Record the payment", async () => {
    await ap.selectOption('main:visible [name="via"]', "check");
    await ap.fill('main:visible [name="reference"]', "1042");
  });
  const f2 = await fee(ids.pend);
  check("payment recorded: paid, by check, ref, season year, audited", paidMsg.includes("Payment recorded") && f2?.status === "paid" && f2.paidVia === "check" && f2.reference === "1042" && f2.paidSeasonYear === getSeasonYear(now) && !!(await AuditLog.exists({ targetId: ids.pend, action: "store.fee_paid" })), paidMsg);

  // 6. Now approval works.
  await ap.goto(`${adminBase}/stores/${ids.pend}`);
  const approved = await submitCard(ap, "Approve this store");
  check("after payment the store can be approved", (await Store.findById(ids.pend).lean())?.status === "approved", approved);

  // 7. Money summary: partner fees on their own line, apart from donations.
  await ap.goto(`${adminBase}/payouts`);
  await ap.locator('main:visible [data-testid="partner-fees"]').waitFor({ timeout: 60_000 });
  const expected = feesBefore.cents + 5_000_000;
  check("payouts: partner fees shown on their own line", (await ap.locator('main:visible [data-testid="partner-fees"]').innerText()).replace(/[$,]/g, "") === (expected / 100).toFixed(2));

  // 8. An INVITED store with a fee due joins as "pending" (not approved) when the owner accepts.
  check("fee set on an invited store", (await setPartnerFee(adminActor, String(ids.inv), 2_500_000, "en")).ok);
  const { raw } = await createActionToken("invite_owner", { email: `e2e-fee-inv-${tag}@spiritofsanta.test`, storeId: String(ids.inv), createdByUserId: admin.id });
  const acc = await acceptStoreInvite({ token: raw, ownerName: "Fee Owner", password: PW, agree: "on" }, { headers: new Headers(), locale: "en", appOrigin: storeBase });
  const invStore = await Store.findById(ids.inv).lean();
  if (invStore?.ownerUserId) extraUsers.push(invStore.ownerUserId as mongooseLib.Types.ObjectId);
  check("invite accepted with a fee due → store waits in 'pending', not approved", acc.ok && invStore?.status === "pending" && !!invStore.ownerUserId);

  // 9. Waive (reason required) and clear.
  check("waiving needs a reason", !(await waivePartnerFee(adminActor, String(ids.inv), " ")).ok);
  check("waived with a reason (audited)", (await waivePartnerFee(adminActor, String(ids.inv), "Small local partner")).ok && (await fee(ids.inv))?.status === "waived" && !!(await AuditLog.exists({ targetId: ids.inv, action: "store.fee_waived" })));
  check("a waived fee can't be set again", !(await setPartnerFee(adminActor, String(ids.inv), 100, "en")).ok);
  await setPartnerFee(adminActor, String(ids.clr), 5_000_000, "en");
  check("clear: due → no fee", (await clearPartnerFee(adminActor, String(ids.clr))).ok && (await fee(ids.clr))?.status === "not_required");

  // 10. Never on a live store (families already use it).
  const live = await setPartnerFee(adminActor, String(ids.live), 5_000_000, "en");
  check("a fee can't be set on an already-approved store", !live.ok && live.error === "badStatus" && !(await fee(ids.live))?.status);

  // 11. The emails went out (dev log) and are business documents, not donation receipts.
  await ap.waitForTimeout(1000);
  const log = readFileSync(adminLog, "utf8").slice(logStart);
  const invoiceMail = log.split("template=partnerFeeInvoice")[1]?.split("---- end")[0] ?? "";
  const paidMail = log.split("template=partnerFeePaid")[1]?.split("---- end")[0] ?? "";
  check("invoice + payment-receipt emails sent to the confirmed owner", invoiceMail.includes(f1?.invoiceNo ?? "?") && paidMail.includes("Payment received") && paidMail.includes("1042"));
  check("fee emails never use tax / donation-receipt wording", !/tax|deductib|goods or services/i.test(invoiceMail + paidMail) && (invoiceMail + paidMail).includes("not a donation"));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const storeIds = Object.values(ids);
  await AuditLog.collection.deleteMany({ $or: [{ targetId: { $in: storeIds } }, { actorUserId: { $in: [new mongooseLib.Types.ObjectId(admin.id), ...extraUsers] } }] });
  await Store.collection.deleteMany({ _id: { $in: storeIds } });
  await User.collection.deleteMany({ _id: { $in: [new mongooseLib.Types.ObjectId(admin.id), ...extraUsers] } });
  await mongoose.connection.collection("actiontokens").deleteMany({ storeId: { $in: storeIds } });
  await mongoose.disconnect();
}
process.exit(report());
