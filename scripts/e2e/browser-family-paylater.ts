/**
 * Real-browser E2E (Edge) for Phase 5 slice 4b: "Pay later by text" on a deed's QR page.
 * Texts are PRINTED by the dev server (no TWILIO_DEV_SEND), so nothing is really sent; the Stripe
 * Payment Link is real (test mode).
 *
 *   family server, then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-paylater.ts http://localhost:3000
 *
 * Needs the season open or frozen today. Creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import mongooseLib from "mongoose";
import { connectDb, Deed, Family, Kid, PayLaterRequest, Payment, RateLimit, StripeEvent, Transaction, trusted, User } from "@repo/db";
import { deedToken, hashDeedToken, phoneKey } from "@repo/deeds/qr";
import { getSeasonYear } from "@repo/lib/season";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-paylater.ts <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
// eslint-disable-next-line turbo/no-undeclared-env-vars
const cronSecret = process.env.CRON_SECRET ?? "";
if (!whsec.startsWith("whsec_") || cronSecret.length < 16) throw new Error("STRIPE_WEBHOOK_SECRET / CRON_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
// A test number nobody owns (555-01xx is reserved for fiction); never really texted (dev prints).
const PHONE = "(555) 234-0199";
const E164 = "+15552340199";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const user = await User.create({ email: `e2e-pl-${tag}@spiritofsanta.test`, passwordHash: "x".repeat(60), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `PayLater${tag}`, consent: { version: "test", acceptedAt: new Date() } });
const kid = await Kid.create({ familyId: fam._id, firstName: "Plk", birthYear: 2017, displayName: "P.", registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const year = getSeasonYear(new Date());
const mkDeed = async (extra: object = {}) => {
  const _id = new mongooseLib.Types.ObjectId();
  const token = deedToken(String(_id));
  await Deed.collection.insertOne({ _id, kidId: kid._id, familyId: fam._id, seasonYear: year, locale: "en", status: "pending", customDescription: "E2E deed", qrTokenHash: hashDeedToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000), createdAt: new Date(), updatedAt: new Date(), ...extra });
  return { _id, token };
};
const d1 = await mkDeed();
const d2 = await mkDeed();
const piIds: string[] = [];
const evtIds: string[] = [];

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
const section = (p: Page) => p.locator("main:visible form").filter({ has: p.getByRole("heading", { name: "Pay later by text" }) });
const submit = async (p: Page, opts: { phone?: string; tick?: boolean; amount?: string }) => {
  const s = section(p);
  await s.evaluate((f) => {
    f.querySelectorAll("input").forEach((i) => i.removeAttribute("required")); // the SERVER must check
    f.querySelectorAll("[role=alert],[role=status]").forEach((a) => a.remove());
  });
  if (opts.amount) await s.locator(`input[name="amount"][value="${opts.amount}"]`).check();
  if (opts.phone !== undefined) await s.locator('input[name="phone"]').fill(opts.phone);
  if (opts.tick) await s.locator('input[name="consent"]').check();
  await s.getByRole("button", { name: "Text me the link" }).click();
};
const openDeed = async (p: Page, token: string) => {
  await p.goto(`${base}/d/${token}`);
  await p.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  await hydrated(p);
};

try {
  const page = await newPage();
  await openDeed(page, d1.token);
  // 1. The form on the deed page: registered wording, unticked.
  const s = section(page);
  check("deed page has 'Pay later by text' with the registered wording, box unticked",
    (await s.innerText()).includes("Spirit O Santa will send 1 text with a secure payment link that expires in 7 days") && !(await s.locator('input[name="consent"]').isChecked()));

  // 2. Server refuses: no consent, bad number. Typing kept, box unticked again.
  await submit(page, { phone: PHONE, tick: false });
  await page.locator("main:visible").getByText("tick the box").waitFor({ timeout: 60_000 });
  check("no consent → refused by the server; number kept, box still unticked",
    (await section(page).locator('input[name="phone"]').inputValue()) === PHONE && !(await section(page).locator('input[name="consent"]').isChecked()));
  await hydrated(page);
  await submit(page, { phone: "123", tick: true });
  await page.locator("main:visible").getByText("valid US mobile number").waitFor({ timeout: 60_000 });
  check("invalid number refused", (await PayLaterRequest.countDocuments({ deedId: d1._id })) === 0);

  // 3. Valid → consent record, real single-use Stripe link, one (printed) text.
  await hydrated(page);
  await submit(page, { phone: PHONE, tick: true, amount: "1000" });
  await page.locator("main:visible").getByText("We texted a payment link").waitFor({ timeout: 60_000 });
  const shown = await page.locator("main:visible").innerText();
  check("success shows only a masked number", shown.includes("•••-•••-0199") && !shown.includes("234-0199"));
  const req = await PayLaterRequest.findOne({ deedId: d1._id }).lean();
  check("consent record: number, time, wording version, language; status sent",
    req?.status === "sent" && req.phoneE164 === E164 && req.phoneKey === phoneKey(E164) && req.consentVersion === "sms-2026-11-06" && req.consentLocale === "en" && !!req.consentAt && req.amountCents === 1000 && /^dev-/.test(req.smsSid ?? ""));
  const link = await getStripe().paymentLinks.retrieve(req!.paymentLinkId!);
  check("Stripe link: active, single-use, $10 deed tip metadata",
    link.active && link.restrictions?.completed_sessions?.limit === 1 && link.metadata?.sos_deed_id === String(d1._id) && link.url.startsWith("https://buy.stripe.com/"),
    JSON.stringify({ active: link.active, restrictions: link.restrictions, deed: link.metadata?.sos_deed_id, url: link.url.slice(0, 30) }));
  const days = (req!.expiresAt.getTime() - Date.now()) / 86_400_000;
  check("link expires within 7 days (not later than the deed)", days > 6.9 && days <= 7.01);

  // 4. Reload: the page says it was sent (one per deed); a second request is refused.
  await openDeed(page, d1.token).catch(() => undefined);
  await page.locator("main:visible").getByText("We texted a payment link").waitFor({ timeout: 60_000 });
  check("reopening the deed shows 'already texted' instead of the form", (await section(page).count()) === 0);

  // 5. Per-number limit: 3 per day (2 more fake records + d2's request = refused).
  await PayLaterRequest.collection.insertMany(
    [0, 1].map(() => ({ deedId: new mongooseLib.Types.ObjectId(), kidId: kid._id, familyId: fam._id, phoneE164: E164, phoneKey: phoneKey(E164), consentAt: new Date(), consentVersion: "sms-2026-11-06", consentLocale: "en", amountCents: 500, status: "sent", expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() })),
  );
  const p2 = await newPage();
  await openDeed(p2, d2.token);
  await submit(p2, { phone: PHONE, tick: true });
  await p2.locator("main:visible").getByText("most links allowed today").waitFor({ timeout: 60_000 });
  check("4th text to the same number in a day refused", (await PayLaterRequest.countDocuments({ deedId: d2._id })) === 0);

  // 6. Paid (signed webhooks: PI succeeded + session completed from the link) → tip credited,
  //    deed confirmed, link switched off, request 'paid'.
  const md = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: String(kid._id), sos_family_id: String(fam._id), sos_deed_id: String(d1._id) });
  const piId = `pi_e2epl${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  const now = Math.floor(Date.now() / 1000);
  const send = async (event: object) => {
    const body = JSON.stringify(event);
    return fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  };
  const e1 = `evt_e2epl${randomBytes(6).toString("hex")}`;
  const e2 = `evt_e2epl${randomBytes(6).toString("hex")}`;
  evtIds.push(e1, e2);
  await send({ id: e1, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: 1000, amount_received: 1000, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  await send({ id: e2, object: "event", type: "checkout.session.completed", livemode: false, created: now, data: { object: { id: `cs_test_e2epl${tag}`, object: "checkout.session", payment_status: "paid", status: "complete", payment_link: req!.paymentLinkId, payment_intent: piId, metadata: md, livemode: false } } });
  const [k, d, after, l2] = await Promise.all([Kid.findById(kid._id).lean(), Deed.findById(d1._id).lean(), PayLaterRequest.findOne({ deedId: d1._id }).lean(), getStripe().paymentLinks.retrieve(req!.paymentLinkId!)]);
  check("paid: 6.66 points, deed confirmed 'paid', link switched off, request 'paid'",
    k?.availableCentipoints === 666 && d?.status === "confirmed" && d.outcome === "paid" && !l2.active && after?.status === "paid");

  // 7. Expiry: a sent request past its date → the daily cron switches its link off.
  const d3 = await mkDeed();
  const p3 = await newPage();
  await PayLaterRequest.collection.deleteMany({ phoneKey: phoneKey(E164), deedId: { $ne: d1._id } }); // free the daily limit
  await openDeed(p3, d3.token);
  await submit(p3, { phone: "(555) 234-0198", tick: true });
  await p3.locator("main:visible").getByText("We texted a payment link").waitFor({ timeout: 60_000 });
  const r3 = await PayLaterRequest.findOne({ deedId: d3._id }).lean();
  await PayLaterRequest.updateOne({ _id: r3!._id }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
  const cron = await fetch(`${base}/api/cron/money`, { headers: { authorization: `Bearer ${cronSecret}` } });
  const cj = (await cron.json()) as { payLater?: { expired?: number } };
  const l3 = await getStripe().paymentLinks.retrieve(r3!.paymentLinkId!);
  check("daily cron switches off an expired link", cron.status === 200 && (cj.payLater?.expired ?? 0) >= 1 && !l3.active && (await PayLaterRequest.findById(r3!._id).lean())?.status === "expired", JSON.stringify(cj.payLater));

  // 8. Spanish deed page shows the Spanish wording.
  const es = await newPage();
  await es.goto(`${base}/es/d/${d2.token}`);
  await es.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  check("Spanish deed page: Spanish consent wording", (await es.locator("main:visible").innerText()).includes("Spirit O Santa enviará 1 mensaje de texto"));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  // Switch off any link this test made, then remove everything.
  const reqs = await PayLaterRequest.find({ familyId: fam._id }).select("paymentLinkId").lean();
  for (const r of reqs) if (r.paymentLinkId) await getStripe().paymentLinks.update(r.paymentLinkId, { active: false }).catch(() => undefined);
  await PayLaterRequest.collection.deleteMany({ familyId: fam._id });
  await Transaction.collection.deleteMany({ kidId: kid._id });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } });
  await Deed.collection.deleteMany({ familyId: fam._id });
  await Kid.collection.deleteMany({ familyId: fam._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteOne({ _id: user._id });
  await RateLimit.collection.deleteMany({ key: trusted({ $regex: "^qr-paylater:" }) });
  await mongoose.disconnect();
}
process.exit(report());
