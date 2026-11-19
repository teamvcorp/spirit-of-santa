/**
 * Real-browser E2E (Edge) for STORE CHRISTMAS MAGIC GIFTS + the North Star (founding partners slice 3a).
 *
 *   family (NEXTAUTH_URL = its own URL) and store (FAMILY_APP_URL = the family URL) dev servers, then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-store-gifts.ts \
 *        http://localhost:3000 http://localhost:3001 <store-dev-log>
 *
 * Proves: a gift link goes only to a CONFIRMED owner; /donate?store= shows "Giving as" with $50,000 suggested; the
 * checkout carries sos_store_id (server-side) and uses the link up; a used link falls back to a normal gift; a store
 * gift above the public $50,000 cap is accepted and recorded with storeId; the North Star appears on Our stores and
 * on gift cards once the season total reaches the admin threshold, and goes away for a refunded gift; the store
 * owner can email themselves a link from the dashboard. *_dev database only; restores the platform settings.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import mongooseLib from "mongoose";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { ActionToken, connectDb, DonationReceipt, Item, Payment, PlatformSettings, RateLimit, Store, StripeEvent, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { createActionToken } from "@repo/auth/tokens";
import { DONOR_ACK_VERSION } from "@repo/lib/donor-ack";
import { getSeasonYear } from "@repo/lib/season";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { sendStoreGiftLink } from "@repo/stores/store-gifts";
import { browseGifts, parseGiftQuery } from "@repo/wishlists/catalog";
import { makeChecks } from "./lib.ts";

const [base, storeBase, storeLog] = process.argv.slice(2);
if (!base || !storeBase || !storeLog) throw new Error("usage: <familyUrl> <storeUrl> <storeDevLog>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `gift pass ${tag} long`;
const year = getSeasonYear(new Date());
const oid = () => new mongooseLib.Types.ObjectId();
const started = Math.floor(Date.now() / 1000) - 5;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const savedSettings = await PlatformSettings.collection.findOne({ key: "platform" });
// /donate needs a fee + the charity name; no badge level yet.
await PlatformSettings.collection.updateOne(
  { key: "platform" },
  { $set: { donationFeeBps: savedSettings?.donationFeeBps ?? 500, "charity.legalName": savedSettings?.charity?.legalName || "Academy Test Charity" }, $unset: { donorBadgeCents: 1 } },
  { upsert: true },
);

const owner = await User.create({ email: `e2e-gift-owner-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "store_owner", status: "active", locale: "en" });
const pendingOwner = await User.create({ email: `e2e-gift-unconf-${tag}@spiritofsanta.test`, passwordHash: "x", role: "store_owner", status: "pending" });
const now = new Date();
const ids = { s: oid(), u: oid() };
await Store.collection.insertMany([
  { _id: ids.s, name: `Gift Store ${tag}`, slug: `e2e-gift-s-${tag}`, category: "toys", status: "approved", ownerUserId: owner._id, contact: { email: owner.email }, createdAt: now, updatedAt: now },
  { _id: ids.u, name: `Gift Unconf ${tag}`, slug: `e2e-gift-u-${tag}`, category: "toys", status: "pending", ownerUserId: pendingOwner._id, createdAt: now, updatedAt: now },
]);
await User.updateOne({ _id: owner._id }, { $set: { storeId: ids.s } });
const itemId = oid();
await Item.collection.insertOne({ _id: itemId, storeId: ids.s, seasonYear: year, name: `Gift Kite ${tag}`, description: "A kite.", category: `Toys${tag}`, priceCents: 1500, payoutCents: 1200, inventory: 3, status: "active", stats: { views: 0 }, createdAt: now, updatedAt: now });
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
const sendEvent = async (md: Record<string, string>, amount: number) => {
  const piId = `pi_e2egift${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2egift${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: t, data: { object: { id: piId, object: "payment_intent", amount, amount_received: amount, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: t } } });
  const res = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  return { piId, status: res.status };
};
const donorOnPartners = async (p: Page) => {
  await p.goto(`${base}/partners`);
  await p.locator(`main:visible [data-slug="e2e-gift-s-${tag}"]`).waitFor({ timeout: 60_000 });
  return (await p.locator(`main:visible [data-slug="e2e-gift-s-${tag}"] [data-testid="partner-donor"]`).count()) === 1;
};
const giftCardDonor = async () => (await browseGifts(parseGiftQuery({ q: `Gift Kite ${tag}` }))).items.find((g) => g.name === `Gift Kite ${tag}`)?.storeDonor === true;

try {
  // 1. Gift links go ONLY to a confirmed owner.
  check("no gift link for a store whose owner never confirmed", (await sendStoreGiftLink(String(ids.u), String(owner._id))).ok === false);
  const sent = await sendStoreGiftLink(String(ids.s), String(owner._id));
  check("gift link sent to the confirmed owner (token tied to the store)", sent.ok && !!(await ActionToken.exists({ purpose: "store_gift", storeId: ids.s, email: owner.email, usedAt: null })));

  // 2. /donate?store= : store mode, $50,000 suggested; the checkout carries sos_store_id and uses the link up.
  const { raw } = await createActionToken("store_gift", { email: owner.email, storeId: ids.s });
  const page = await newPage();
  await page.goto(`${base}/donate?store=${raw}`);
  await page.locator('main:visible [data-testid="store-gift"]').waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  check("store mode: 'Giving as {store}', $50,000 pre-selected", (await page.locator('main:visible [data-testid="store-gift"]').innerText()).includes(`Giving as Gift Store ${tag}`) && (await page.locator('main:visible input[name="amount"][value="5000000"]').isChecked()));
  check("the store is never a form field (only the link token travels)", (await page.locator('main:visible [name="storeId"], main:visible [name="sos_store_id"]').count()) === 0);
  await page.locator('main:visible [data-testid="donor-ack"]').check();
  await page.locator("main:visible button[type=submit]").click();
  await page.locator('[data-testid="stripe-checkout"]').waitFor({ timeout: 60_000 });
  const s = (await getStripe().checkout.sessions.list({ created: { gte: started }, limit: 10 })).data.find((x) => x.metadata?.sos_store_id === String(ids.s));
  if (s) sessionIds.push(s.id);
  check("checkout carries sos_store_id + $50,000 (set on the server)", !!s && s.amount_total === 5_000_000 && s.metadata?.sos_purpose === "donation");
  check("the gift link is used up when the checkout starts", !!(await ActionToken.findOne({ purpose: "store_gift", storeId: ids.s, email: owner.email, usedAt: trusted({ $ne: null }) }).lean()));
  const again = await newPage();
  await again.goto(`${base}/donate?store=${raw}`);
  await again.locator("main:visible [role=alert]").first().waitFor({ timeout: 60_000 });
  check("a used link → 'expired or already used', normal gift form (no store mode)", (await again.locator("main:visible").innerText()).includes("expired or was already used") && (await again.locator('main:visible [data-testid="store-gift"]').count()) === 0);

  // 3. Paid: a $60,000 store gift (over the public cap) is accepted and recorded with the store.
  const md = buildPaymentMetadata({ sos_purpose: "donation", sos_locale: "en", sos_ack: DONOR_ACK_VERSION, sos_store_id: String(ids.s) });
  const paid = await sendEvent(md, 6_000_000);
  const pay = await Payment.findOne({ stripePaymentIntentId: paid.piId }).lean();
  check("$60,000 store gift accepted into the pool with storeId (not review)", paid.status === 200 && pay?.fulfilment === "held" && String(pay.storeId) === String(ids.s));

  // 4. North Star: none without a badge level; appears once the season total reaches it; display only.
  const fam = await newPage();
  check("no badge level set → no North Star", !(await donorOnPartners(fam)) && !(await giftCardDonor()));
  await PlatformSettings.collection.updateOne({ key: "platform" }, { $set: { donorBadgeCents: 5_000_000 } });
  check("season total ≥ level → North Star on Our stores", await donorOnPartners(fam));
  check("…and beside the store name on its gift cards", await giftCardDonor());
  await PlatformSettings.collection.updateOne({ key: "platform" }, { $set: { donorBadgeCents: 7_000_000 } });
  check("season total below a higher level → no North Star", !(await donorOnPartners(fam)));
  await PlatformSettings.collection.updateOne({ key: "platform" }, { $set: { donorBadgeCents: 5_000_000 } });
  await Payment.updateOne({ stripePaymentIntentId: paid.piId }, { $set: { refundedCents: 6_000_000 } });
  check("a refunded gift doesn't count", !(await donorOnPartners(fam)));

  // 5. The owner emails themselves a link from the store dashboard.
  await RateLimit.collection.deleteMany({ key: `giftlink:store:${ids.s}` });
  const sp = await newPage();
  await sp.goto(`${storeBase}/signin`);
  await sp.waitForFunction(() => [...document.querySelectorAll("main button[type=submit]")].some((b) => b.checkVisibility() && !(b as HTMLButtonElement).disabled), undefined, { timeout: 60_000 });
  await sp.fill('[name="email"]', owner.email);
  await sp.fill('[name="password"]', PW);
  await sp.click("main:visible button[type=submit]");
  await sp.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await sp.goto(`${storeBase}/dashboard`);
  await sp.locator('main:visible [data-testid="gift-link-button"]').waitFor({ timeout: 60_000 });
  await sp.waitForFunction(() => !(document.querySelector('[data-testid="gift-link-button"]') as HTMLButtonElement)?.disabled, undefined, { timeout: 60_000 });
  const logStart = readFileSync(storeLog, "utf8").length;
  await sp.locator('main:visible [data-testid="gift-link-button"]').click();
  await sp.locator('main:visible [data-testid="gift-card"] [role="status"], main:visible [data-testid="gift-card"] [role="alert"]').first().waitFor({ timeout: 60_000 });
  await sp.waitForTimeout(500);
  const mail = readFileSync(storeLog, "utf8").slice(logStart);
  check("owner's dashboard button emails them a store gift link", (await sp.locator('main:visible [data-testid="gift-card"]').innerText()).includes("Sent!") && mail.includes(`to=${owner.email} template=storeGiftLink`) && mail.includes("/donate?store="));
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
  await Item.collection.deleteOne({ _id: itemId });
  await Store.collection.deleteMany({ _id: { $in: Object.values(ids) } });
  await ActionToken.collection.deleteMany({ storeId: { $in: Object.values(ids) } });
  await RateLimit.collection.deleteMany({ key: `giftlink:store:${ids.s}` });
  await User.collection.deleteMany({ _id: { $in: [owner._id, pendingOwner._id] } });
  await PlatformSettings.collection.deleteOne({ key: "platform" });
  if (savedSettings) await PlatformSettings.collection.insertOne(savedSettings);
  await mongoose.disconnect();
}
process.exit(report());
