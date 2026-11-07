/**
 * Real-browser E2E (Edge) for Phase 6 slice 5: store payouts (owed when received, recorded by an
 * admin, paid outside the app) and the season money summary.
 *
 *   admin dev server on :3002 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-payouts.ts http://localhost:3002
 *
 * Uses its own MFA admin. The money summary is checked as DIFFERENCES (before/after this test's
 * rows), because the dev database holds other data too. *_dev only; removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Item, Payment, Store, StorePayout, Transaction, trusted, User, WishListItem } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { markReceived } from "@repo/wishlists/fulfilment";
import { owedByStore, recordPayout, seasonMoney, storePayoutView } from "@repo/wishlists/payouts";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-admin-payouts.ts <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const year = getSeasonYear();

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const admin = await createMfaAdmin(`e2e-pay-${tag}@spiritofsanta.test`);
const before = await seasonMoney(year);

// Store A: 20% discount. Store B: no discount on record yet.
const storeA = oid();
const storeB = oid();
await Store.collection.insertMany([
  { _id: storeA, name: `Pay A ${tag}`, slug: `e2e-pay-a-${tag}`, status: "approved", discountBps: 2000, contact: { email: `a-${tag}@spiritofsanta.test` }, createdAt: new Date(), updatedAt: new Date() },
  { _id: storeB, name: `Pay B ${tag}`, slug: `e2e-pay-b-${tag}`, status: "approved", contact: { email: `b-${tag}@spiritofsanta.test` }, createdAt: new Date(), updatedAt: new Date() },
]);
const itemId = oid();
await Item.collection.insertOne({ _id: itemId, storeId: storeA, seasonYear: year, name: `Gift ${tag}`, priceCents: 2500, inventory: 3, status: "active", createdAt: new Date(), updatedAt: new Date() });
const shipped = async (storeId: unknown, cost: number) => {
  const _id = oid();
  await WishListItem.collection.insertOne({ _id, kidId: oid(), familyId: oid(), itemId, storeId, seasonYear: year, costCentipoints: cost, fundedCentipoints: cost, status: "shipped", shippedAt: new Date(), fullyFundedAt: new Date(), createdAt: new Date(), updatedAt: new Date() });
  return String(_id);
};
const a1 = await shipped(storeA, 2500); // owed 20.00
const a2 = await shipped(storeA, 1000); // owed 8.00
const a3 = await shipped(storeA, 500); // received while the admin has the page open: owed 4.00
const b1 = await shipped(storeB, 600); // no discount → no amount yet
const gifts = [a1, a2, a3, b1];
// This season's money (raw rows, like the webhook writes them).
const pis = [`pi_e2epo${randomBytes(5).toString("hex")}`, `pi_e2epo${randomBytes(5).toString("hex")}`];
await Payment.collection.insertMany([
  { stripePaymentIntentId: pis[0], livemode: false, purpose: "tip", status: "succeeded", seasonYear: year, amountCents: 3000, currency: "usd", fulfilment: "credited", refundedCents: 0, dispute: { status: "lost", amountCents: 500 }, createdAt: new Date(), updatedAt: new Date() },
  { stripePaymentIntentId: pis[1], livemode: false, purpose: "payup", status: "succeeded", seasonYear: year, amountCents: 1500, currency: "usd", fulfilment: "credited", refundedCents: 0, createdAt: new Date(), updatedAt: new Date() },
]);
const ledgerKid = oid();
await Transaction.collection.insertOne({ kidId: ledgerKid, familyId: oid(), seasonYear: year, type: "forfeit", amountCentipoints: 300, idempotencyKey: `forfeit:e2e-${tag}`, createdAt: new Date() });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const storeRow = (id: unknown) => page.locator(`main:visible [data-testid="owed"] li[data-store="${String(id)}"]`);

try {
  // 1. Received → owed, amount fixed at receipt (price − 20%).
  for (const g of [a1, a2, b1]) await markReceived(admin.id, g);
  const [w1, w2, wb] = await Promise.all([a1, a2, b1].map((g) => WishListItem.findById(g).lean()));
  check("received gifts are owed at price − store discount (fixed at receipt)", w1?.payoutOwedCents === 2000 && w2?.payoutOwedCents === 800 && wb?.payoutOwedCents == null);

  // 2. Admin page: store A owed $28 for 2 gifts; store B blocked (no discount).
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.locator('a[href$="/payouts"]').first().click();
  await page.waitForURL((u) => u.pathname.endsWith("/payouts"), { timeout: 60_000 });
  await storeRow(storeA).waitFor({ timeout: 60_000 });
  check("store A: '$28.00 for 2 gifts' with a payment form", (await storeRow(storeA).innerText()).includes("$28.00 for 2 gifts") && (await storeRow(storeA).locator("form").count()) === 1);
  check("store B: no form, explains the missing discount", (await storeRow(storeB).locator("form").count()) === 0 && (await storeRow(storeB).innerText()).includes("no discount on record"));

  // 3. Another gift is received while the page is open → recording the OLD amount is refused.
  await markReceived(admin.id, a3);
  await hydrated(page);
  await storeRow(storeA).locator('input[name="reference"]').fill("1042");
  await storeRow(storeA).locator('input[name="confirm"]').check();
  await storeRow(storeA).getByRole("button", { name: "Record payment" }).click();
  await storeRow(storeA).locator("[role=alert]", { hasText: "amount owed changed" }).waitFor({ timeout: 60_000 });
  check("amount changed since the page loaded → refused (nothing recorded)", (await StorePayout.countDocuments({ storeId: storeA })) === 0);

  // 4. Reload: $32 for 3 gifts → record it.
  await page.reload();
  await storeRow(storeA).waitFor({ timeout: 60_000 });
  check("after reload: '$32.00 for 3 gifts'", (await storeRow(storeA).innerText()).includes("$32.00 for 3 gifts"));
  await hydrated(page);
  await storeRow(storeA).locator('input[name="reference"]').fill("1042");
  await storeRow(storeA).locator('input[name="confirm"]').check();
  await storeRow(storeA).getByRole("button", { name: "Record payment" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/payouts") && !!u.searchParams.get("paid"), { timeout: 60_000 });
  await page.locator("main:visible [role=status]", { hasText: `Payment of $32.00 to Pay A ${tag} recorded` }).waitFor({ timeout: 60_000 });
  check("confirmation shown at page level (the store row is gone once paid)", true);
  const p = await StorePayout.findOne({ storeId: storeA }).lean();
  const paid = await WishListItem.countDocuments({ _id: trusted({ $in: [a1, a2, a3] }), payoutId: p?._id });
  check("payout recorded: $32.00, 3 gifts, check #1042, each gift linked to it", p?.amountCents === 3200 && p.giftCount === 3 && p.method === "check" && p.reference === "1042" && paid === 3);
  check("payout audited", (await AuditLog.countDocuments({ action: "payout.record", targetId: storeA })) === 1);
  await page.reload();
  await page.locator('main:visible [data-testid="history"]').waitFor({ timeout: 60_000 });
  check("history lists it; store A no longer owed", (await page.locator('main:visible [data-testid="history"]').innerText()).includes(`Pay A ${tag}`) && (await storeRow(storeA).count()) === 0);

  // 5. Never paid twice; store B refused until its discount exists, then computed.
  const again = await recordPayout(admin.id, String(storeA), { method: "check", reference: "", paidOn: "2026-11-06", note: "" });
  const bNo = await recordPayout(admin.id, String(storeB), { method: "check", reference: "", paidOn: "2026-11-06", note: "" });
  check("server: store A again → nothingOwed; store B (no discount) → missingAmount", !again.ok && again.error === "nothingOwed" && !bNo.ok && bNo.error === "missingAmount");
  const bad = await recordPayout(admin.id, String(storeA), { method: "cash<script>", reference: "", paidOn: "nope", note: "" });
  check("server: bad method/date refused", !bad.ok && bad.error === "invalid");
  await Store.collection.updateOne({ _id: storeB }, { $set: { discountBps: 1000 } });
  const owedB = (await owedByStore()).find((o) => o.storeId === String(storeB));
  check("once store B has a discount, its gift's amount is filled in (600 − 10% = 540)", owedB?.owedCents === 540 && owedB.missingAmount === 0);

  // 6. Store app view (storeId from the member's own store).
  const view = await storePayoutView(storeA);
  check("store A sees its payment and owes nothing", view.owedCount === 0 && view.payouts.length === 1 && view.payouts[0]?.amountCents === 3200);

  // 7. Season money: differences caused by this test's rows.
  const after = await seasonMoney(year);
  const d = (x: number, y: number) => x - y;
  check("collected +$45 (tip 30 + pay-up 15); given back +$5 (lost chargeback)", d(after.collectedTotal, before.collectedTotal) === 4500 && d(after.givenBack, before.givenBack) === 500);
  check("received gifts +4 (retail $46); wholesale owed+paid +$37.40", d(after.gifts.count, before.gifts.count) === 4 && d(after.gifts.retailCents, before.gifts.retailCents) === 4600 &&
    d(after.gifts.wholesalePaidCents + after.gifts.wholesaleOwedCents, before.gifts.wholesalePaidCents + before.gifts.wholesaleOwedCents) === 3740);
  check("wholesale margin +$8.60; breakage +3 points; net = collected − given back − wholesale", d(after.wholesaleMarginCents, before.wholesaleMarginCents) === 860 &&
    d(after.breakage.forfeitCentipoints, before.breakage.forfeitCentipoints) === 300 && d(after.netCents, before.netCents) === 4500 - 500 - 3740);

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  const ids = gifts.map((g) => new mongoose.Types.ObjectId(g));
  await Promise.all([
    WishListItem.collection.deleteMany({ _id: { $in: ids } }),
    StorePayout.collection.deleteMany({ storeId: { $in: [storeA, storeB] } }),
    AuditLog.collection.deleteMany({ $or: [{ targetId: { $in: [...ids, storeA, storeB] } }, { actorUserId: new mongoose.Types.ObjectId(admin.id) }] }),
    Payment.collection.deleteMany({ stripePaymentIntentId: { $in: pis } }),
    Transaction.collection.deleteMany({ kidId: ledgerKid }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteMany({ _id: { $in: [storeA, storeB] } }),
    User.deleteOne({ _id: admin.id }),
  ]);
  await mongoose.disconnect();
}
report();
