/**
 * E2E for NEWS + DONORS (owner 2026-11-12, slice 3): the unticked "keep me posted" box on /donate travels in the
 * Stripe checkout metadata (sos_news); a paid donation with it never breaks the webhook; a donor's confirm link
 * (sendNewsConfirm, as the webhook calls it with the Stripe email) subscribes them with source "donor".
 *
 *   family dev server on :3000, Stripe TEST keys, season OPEN, then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-news-donor.ts http://localhost:3000
 *
 * Why not a real paid checkout: a test card payment in the embedded form isn't scriptable reliably, and the email
 * only exists in a completed Checkout Session. The webhook step that reads it is small (handlers.ts afterNewsOptIn);
 * everything around it is tested here. *_dev only; restores platform settings; expires its test sessions.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { DONOR_ACK_VERSION } from "@repo/lib/donor-ack";
import { chromium, type Page } from "playwright-core";
import { ActionToken, connectDb, DonationReceipt, NewsSubscription, Payment, PlatformSettings, RateLimit, StripeEvent, trusted } from "@repo/db";
import { sendNewsConfirm } from "@repo/auth/news";
import { createActionToken } from "@repo/auth/tokens";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-news-donor.ts <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const donorMail = `news-donor-${tag}@spiritofsanta.test`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const savedSettings = await PlatformSettings.collection.findOne({ key: "platform" });
// /donate needs a platform fee AND the charity name (the donor acknowledgment names it); closed otherwise.
await PlatformSettings.collection.updateOne(
  { key: "platform" },
  { $set: { donationFeeBps: savedSettings?.donationFeeBps ?? 500, "charity.legalName": savedSettings?.charity?.legalName || "Academy Test Charity" } },
  { upsert: true },
);
const started = Math.floor(Date.now() / 1000) - 5;
const piIds: string[] = [];
const evtIds: string[] = [];
const sessionIds: string[] = [];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });

/** Start a donation on /donate (default amount), optionally ticking the news box; returns the new test session. */
async function startDonation(tick: boolean) {
  await page.goto(`${base}/donate`);
  await page.waitForLoadState("networkidle"); // tick only after React has hydrated the form
  // The required acknowledgment (2026-11-18): the pay button stays disabled until it is ticked.
  await page.locator('main:visible [data-testid="donor-ack"]').check();
  await hydrated(page);
  const box = page.locator('main:visible [data-testid="news-opt-in"]');
  const unticked = !(await box.isChecked());
  if (tick) await box.check();
  const before = new Set(sessionIds);
  await page.locator("main:visible button[type=submit]").click();
  await page.locator('[data-testid="stripe-checkout"]').waitFor({ timeout: 60_000 });
  const list = await getStripe().checkout.sessions.list({ created: { gte: started }, limit: 10 });
  const s = list.data.find((x) => x.metadata?.sos_purpose === "donation" && !before.has(x.id));
  if (s) sessionIds.push(s.id);
  return { unticked, session: s };
}

try {
  // 1. The box is unticked; ticked → the checkout carries sos_news=1 (session AND PaymentIntent metadata).
  const a = await startDonation(true);
  check("donate form: news box not pre-ticked", a.unticked);
  check("ticked → checkout metadata sos_news=1 (session + payment intent data)",
    a.session?.metadata?.sos_news === "1" && a.session?.metadata?.sos_purpose === "donation");
  check("real checkout carries the donor acknowledgment version (sos_ack)", a.session?.metadata?.sos_ack === DONOR_ACK_VERSION);
  // 2. Not ticked → no sos_news.
  const b = await startDonation(false);
  check("not ticked → no sos_news in the checkout", !!b.session && b.session.metadata?.sos_news === undefined);

  // 3. A paid donation WITH sos_news (no real Checkout email for a made-up id): recorded, webhook still 200.
  const piId = `pi_e2enews${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2enews${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const now = Math.floor(Date.now() / 1000);
  const md = buildPaymentMetadata({ sos_purpose: "donation", sos_locale: "es", sos_news: "1" });
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: 2500, amount_received: 2500, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  const res = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  check("paid donation with the news tick: webhook 200, payment recorded (news step never breaks payments)",
    res.status === 200 && !!(await Payment.exists({ stripePaymentIntentId: piId, status: "succeeded" })));
  // Same payment delivered AGAIN (Stripe retry / the return page racing the webhook): the send is claimed once.
  const firstClaim = (await Payment.findOne({ stripePaymentIntentId: piId }).lean())?.newsAskedAt;
  const evt2 = `evt_e2enews${randomBytes(6).toString("hex")}`;
  evtIds.push(evt2);
  const body2 = body.replace(evtId, evt2);
  const res2 = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body2, secret: whsec }) }, body: body2 });
  const secondClaim = (await Payment.findOne({ stripePaymentIntentId: piId }).lean())?.newsAskedAt;
  check("delivered twice: the confirm email is claimed ONCE (newsAskedAt unchanged)",
    res2.status === 200 && !!firstClaim && secondClaim?.getTime() === firstClaim.getTime());

  // 4. What the webhook does with the Stripe email: a donor confirm link in the page language, then the click.
  await sendNewsConfirm(donorMail, "donor", "es", base);
  const tok = await ActionToken.findOne({ email: donorMail, purpose: "news_confirm" }).lean();
  check("donor confirm link: source donor, Spanish", tok?.newsSource === "donor" && tok.locale === "es");
  check("not on the list before the click", !(await NewsSubscription.exists({ email: donorMail })));
  const { raw } = await createActionToken("news_confirm", { email: donorMail, newsSource: "donor", locale: "es" });
  await page.goto(`${base}/es/news/confirm?token=${raw}`);
  await hydrated(page);
  await page.locator("main:visible button[type=submit]").click();
  await page.locator("main:visible [role=status]").first().waitFor({ timeout: 60_000 });
  const row = await NewsSubscription.findOne({ email: donorMail }).lean();
  check("donor confirmed (Spanish page): subscribed, source donor, locale es", row?.status === "subscribed" && row.source === "donor" && row.locale === "es");
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
  await ActionToken.deleteMany({ email: donorMail });
  await NewsSubscription.deleteMany({ email: donorMail });
  await RateLimit.deleteMany({ key: trusted({ $regex: "^(news|qr-community):" }) });
  await PlatformSettings.collection.deleteOne({ key: "platform" });
  if (savedSettings) await PlatformSettings.collection.insertOne(savedSettings);
  await mongoose.disconnect();
}
process.exit(report());
