/**
 * Real-browser E2E (Edge) for Phase 5 slice 2a: community donations (/donate), admin platform
 * settings (/settings) and tax receipts.
 *
 *   family + admin servers (dev or `next start`), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *        scripts/e2e/browser-community-donate.ts http://localhost:3000 http://localhost:3002
 *
 * Needs the season OPEN today (before the freeze). Saves and RESTORES the platform settings
 * document; creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, DonationReceipt, Payment, PlatformSettings, StripeEvent, User } from "@repo/db";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base, adminBase] = process.argv.slice(2);
if (!base || !adminBase) throw new Error("usage: browser-community-donate.ts <familyUrl> <adminUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
// Save the real settings and start from "never set".
const savedSettings = await PlatformSettings.collection.findOne({ key: "platform" });
await PlatformSettings.collection.deleteOne({ key: "platform" });
const admin = await createMfaAdmin(`e2e-settings-${tag}@spiritofsanta.test`);
const piIds: string[] = [];
const evtIds: string[] = [];
const sessionIds: string[] = [];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const newPage = async () => {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
};
// Next 16 keeps the previous page in the DOM, hidden: only look at what is visible.
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const text = async (p: Page, url: string) => {
  await p.goto(url);
  await p.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  await p.waitForLoadState("networkidle"); // the Suspense content streams in after the heading
  await p.locator("main:visible [role=alert], main:visible [role=status], main:visible form, main:visible p").first().waitFor({ timeout: 60_000 });
  return p.locator("main:visible").innerText();
};
const sendEvent = async (md: Record<string, string>, amount: number) => {
  const piId = `pi_e2ecom${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2ecom${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount, amount_received: amount, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  const res = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  return { piId, evtId, body, status: res.status };
};

try {
  const visitor = await newPage();
  // 1. No fee chosen yet → the public page stays closed.
  check("no platform fee set → /donate is closed", (await text(visitor, `${base}/donate`)).includes("aren't open right now"));

  // 2. Admin sets the fee (bad values refused; receipts need the charity), audited.
  const ap = await newPage();
  await ap.goto(`${adminBase}/signin`);
  await hydrated(ap);
  await ap.fill('[name="email"]', admin.email);
  await ap.fill('[name="password"]', admin.password);
  await ap.fill('[name="code"]', await admin.nextCode());
  await ap.click("main:visible button[type=submit]");
  await ap.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  check("admin header has a Settings link", (await ap.locator('header a[href$="/settings"]').count()) > 0);
  const settingsText = await text(ap, `${adminBase}/settings`);
  check("settings page warns the fee isn't set", settingsText.includes("isn't set yet"));
  const save = async (fields: Record<string, string>, receipts = false) => {
    await hydrated(ap);
    for (const [k, v] of Object.entries(fields)) await ap.fill(`main:visible [name="${k}"]`, v);
    const box = ap.locator('main:visible input[name="receipts"]');
    if ((await box.isChecked()) !== receipts) await box.click();
    await ap.evaluate(() => {
      document.querySelectorAll("main input").forEach((i) => i.removeAttribute("pattern")); // server must check
      document.querySelectorAll("main form [role=alert], main form [role=status]").forEach((a) => a.remove()); // wait for a FRESH result
    });
    await ap.locator("main:visible button[type=submit]").click();
    // The form's own result (the page also has a "fee isn't set" alert outside the form).
    const result = ap.locator("main:visible form [role=alert], main:visible form [role=status]").first();
    await result.waitFor({ timeout: 60_000 }).catch(async (e) => {
      console.error("DBG main:", (await ap.locator("main:visible").innerText()).slice(0, 500), "| db:", JSON.stringify(await PlatformSettings.findOne({ key: "platform" }).lean()));
      throw e;
    });
    return result.innerText();
  };
  check("fee over 30% refused", (await save({ fee: "45" })).includes("between 0 and 30"));
  check("bad EIN refused", (await save({ fee: "12.5", ein: "123" })).includes("12-3456789"));
  check("receipts ON without the charity refused", (await save({ fee: "12.5", ein: "", legalName: "" }, true)).includes("legal name and EIN"));
  check("fee 12.5% saved", (await save({ fee: "12.5", ein: "", legalName: "" })).includes("Saved"));
  const st1 = await PlatformSettings.findOne({ key: "platform" }).lean();
  check("stored as 1250 basis points, receipts off, audited",
    st1?.donationFeeBps === 1250 && st1.receiptsEnabled === false && (await AuditLog.countDocuments({ actorUserId: admin.id, action: "settings.update" })) === 1);

  // 3. Public page now open: rules stated plainly; no receipt promise while receipts are off.
  const page1 = await text(visitor, `${base}/donate`);
  check("donate page states the equal split, the share day and the 12.5% fee", page1.includes("shared equally") && page1.includes("12.5%") && /December \d+/.test(page1));
  check("no tax-receipt promise while receipts are off", !page1.includes("501(c)(3)"));
  check("header has a Donate link", (await visitor.locator('header a[href$="/donate"]').count()) > 0);

  // 4. Server-side validation (browser hints removed); the typed choices are kept.
  await hydrated(visitor);
  await visitor.check('main:visible input[name="scope"][value="zip"]');
  await visitor.fill('main:visible [name="zip"]', "12");
  await visitor.evaluate(() => document.querySelectorAll("main input").forEach((i) => i.removeAttribute("pattern")));
  await visitor.locator("main:visible button[type=submit]").click();
  await visitor.locator("main:visible").getByText("5-digit ZIP").waitFor({ timeout: 60_000 });
  await hydrated(visitor);
  check("bad ZIP refused by the server; ZIP choice + typing kept",
    (await visitor.locator('main:visible input[name="scope"][value="zip"]').isChecked()) && (await visitor.inputValue('main:visible [name="zip"]')) === "12");
  await visitor.fill('main:visible [name="zip"]', "50588");
  await visitor.check('main:visible input[name="amount"][value="other"]');
  await visitor.fill('main:visible [name="other"]', "2");
  await visitor.locator("main:visible button[type=submit]").click();
  await visitor.locator("main:visible").getByText("Choose an amount between $5.00").waitFor({ timeout: 60_000 });
  check("gift under $5 refused by the server", true);

  // 5. $50 for ZIP 50588 → Stripe's embedded form.
  await hydrated(visitor);
  await visitor.check('main:visible input[name="amount"][value="5000"]');
  await visitor.locator("main:visible button[type=submit]").click();
  await visitor.locator('[data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 60_000 });
  check("$50 ZIP gift opens Stripe's embedded form", ((await visitor.locator('[data-testid="stripe-checkout"] iframe').first().getAttribute("src")) ?? "").startsWith("https://js.stripe.com/"));

  // 6. Paid (signed webhook) → held in the ZIP pool, receipt row once; out-of-bounds → review.
  const md = buildPaymentMetadata({ sos_purpose: "donation", sos_zip: "50588", sos_locale: "es" });
  const paid = await sendEvent(md, 5000);
  const pay = await Payment.findOne({ stripePaymentIntentId: paid.piId }).lean();
  check("donation recorded HELD in the 50588 pool, no points", paid.status === 200 && pay?.fulfilment === "held" && pay.zip === "50588" && pay.pointsCreditedCentipoints === 0);
  // Replay the same event: no second payment or receipt.
  await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: paid.body, secret: whsec }) }, body: paid.body });
  check("receipt row created exactly once (replayed event)", (await DonationReceipt.countDocuments({ stripePaymentIntentId: paid.piId })) === 1);
  const tooBig = await sendEvent(buildPaymentMetadata({ sos_purpose: "donation" }), 6_000_000);
  check("$60,000 donation (over the cap) → review, not pooled", (await Payment.findOne({ stripePaymentIntentId: tooBig.piId }).lean())?.fulfilment === "review" && tooBig.status === 200);

  // 7. A waiting receipt (as if Stripe gave the donor's email) goes out when receipts are switched on.
  const rid = `pi_e2ecomrcpt${randomBytes(6).toString("hex")}`;
  piIds.push(rid);
  await DonationReceipt.create({ stripePaymentIntentId: rid, receiptNo: `SOS-2026-E2E${tag.toUpperCase()}`, seasonYear: 2026, amountCents: 2500, donatedAt: new Date(), email: "delivered+e2ereceipt@resend.dev", donorName: "E2E Donor", locale: "en", link: `${base}/donate` });
  const msg = await save({ fee: "12.5", legalName: "Edynsgate Test Charity", ein: "12-3456789", address: "1 Test St" }, true);
  const r = await DonationReceipt.findOne({ stripePaymentIntentId: rid }).lean();
  check("switching receipts on emails the waiting receipt", msg.includes("waiting receipt was emailed") && r?.status === "sent" && !!r.sentAt, msg);
  check("admin sees receipt counts", (await text(ap, `${adminBase}/settings`)).includes("Sent:"));

  // 8. Public page now promises the receipt and names the charity; season total shown.
  const page2 = await text(visitor, `${base}/donate`);
  check("donate page names the 501(c)(3) and EIN once receipts are on", page2.includes("Edynsgate Test Charity") && page2.includes("12-3456789"));
  check("season total shown", (await visitor.locator('main:visible [data-testid="season-total"]').count()) === 1);

  // 9. Thanks page: real unpaid session → not completed; unknown → not found; a non-donation session → not found.
  const s = await getStripe().checkout.sessions.create({
    ui_mode: "embedded_page", mode: "payment", metadata: md, return_url: `${base}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 2500, product_data: { name: "E2E community gift" } } }],
  });
  sessionIds.push(s.id);
  check("thanks: unpaid session → 'wasn't completed'", (await text(visitor, `${base}/donate/thanks?session_id=${s.id}`)).includes("wasn't completed"));
  check("thanks: unknown session → not found", (await text(visitor, `${base}/donate/thanks?session_id=cs_test_${"q".repeat(20)}`)).includes("couldn't find"));
  const other = await getStripe().checkout.sessions.create({
    ui_mode: "embedded_page", mode: "payment", return_url: `${base}/x?session_id={CHECKOUT_SESSION_ID}`,
    metadata: buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: "a".repeat(24), sos_family_id: "b".repeat(24) }),
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 500, product_data: { name: "E2E not a donation" } } }],
  });
  sessionIds.push(other.id);
  check("thanks: someone's tip session isn't shown here", (await text(visitor, `${base}/donate/thanks?session_id=${other.id}`)).includes("couldn't find"));

  // 10. Spanish.
  const es = await newPage();
  check("Spanish donate page", (await text(es, `${base}/es/donate`)).includes("Regala a los niños"));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  for (const id of sessionIds) await getStripe().checkout.sessions.expire(id).catch(() => undefined);
  await DonationReceipt.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } });
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await User.collection.deleteOne({ _id: new mongoose.Types.ObjectId(admin.id) });
  // Put the real settings back exactly as they were.
  await PlatformSettings.collection.deleteOne({ key: "platform" });
  if (savedSettings) await PlatformSettings.collection.insertOne(savedSettings);
  await mongoose.disconnect();
}
process.exit(report());
