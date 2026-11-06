/**
 * Real-browser E2E (Edge) for Phase 5 slice 1: parent "bonus magic" (/parent/bonus).
 *
 *   family: (apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *           (or the dev server on :3000)
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-bonus.ts http://localhost:3016
 *
 * Needs the season open or frozen today. Creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, Kid, Payment, RateLimit, StripeEvent, Transaction, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { startBonus } from "@repo/families/bonus";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-bonus.ts <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `bonus pass ${tag}`;
const PIN = "8152";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const mkFamily = async (name: string) => {
  const user = await User.create({ email: `e2e-bon-${name}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const family = await Family.create({ ownerUserId: user._id, familyName: `Bon${name}${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: family._id } });
  return { user, family };
};
const A = await mkFamily("a");
const B = await mkFamily("b");
const registered = { status: "registered", registeredAt: new Date(), method: "card" };
const maya = await Kid.create({ familyId: A.family._id, firstName: "Maya", birthYear: 2017, displayName: "M.", registration: registered });
const zoe = await Kid.create({ familyId: A.family._id, firstName: "Zoe", birthYear: 2019, displayName: "Z.", registration: registered });
const leo = await Kid.create({ familyId: A.family._id, firstName: "Leo", birthYear: 2018, displayName: "L." }); // awaiting
const other = await Kid.create({ familyId: B.family._id, firstName: "Other", birthYear: 2016, displayName: "O.", registration: registered });
const piIds: string[] = [];
const evtIds: string[] = [];
const sessionIds: string[] = [];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    // Next 16 keeps the previous page in the DOM, hidden: only look at what is visible.
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const mainText = async (url: string) => {
  await page.goto(url);
  await page.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  await page.locator("main:visible [role=alert], main:visible form, main:visible p").first().waitFor({ timeout: 60_000 });
  return page.locator("main:visible").innerText();
};
const parentA = { id: String(A.user._id), familyId: String(A.family._id) };

try {
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });

  // 1. Locked → the PIN page first.
  await page.goto(`${base}/parent/bonus`);
  await page.waitForURL(/\/parent\/pin$/, { timeout: 60_000 });
  check("bonus page needs the parent PIN", true);
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 60_000 });

  // 2. Dashboard: link only for registered kids, preselecting the kid.
  await page.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  const links = await page.locator('main:visible a[href*="/parent/bonus?kid="]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  check("'Give bonus magic' only for registered kids", links.length === 2 && links.some((h) => h?.endsWith(String(zoe._id))) && !links.some((h) => h?.endsWith(String(leo._id))));
  await page.locator(`main:visible a[href$="/parent/bonus?kid=${zoe._id}"]`).click();
  await page.waitForURL(/\/parent\/bonus\?kid=/, { timeout: 60_000 });
  await page.locator('main:visible input[name="kid"]').first().waitFor({ timeout: 60_000 });
  await hydrated(page);
  const radios = await page.locator('main:visible input[name="kid"]').evaluateAll((els) => els.map((e) => ({ v: (e as HTMLInputElement).value, c: (e as HTMLInputElement).checked })));
  check("form lists registered kids only, with the clicked kid preselected",
    radios.length === 2 && radios.find((r) => r.v === String(zoe._id))?.c === true && !radios.some((r) => r.v === String(leo._id)));

  // 3. Bad amount refused by the server; the picked kid + typed amount are kept.
  await page.check('main:visible input[name="amount"][value="other"]');
  await page.fill('main:visible [name="other"]', "5000");
  await page.locator("main:visible button[type=submit]").click();
  await page.locator("main:visible").getByText("Choose an amount between").waitFor({ timeout: 60_000 });
  await hydrated(page);
  check("over-$1,000 bonus refused; child and typed amount kept",
    (await page.locator(`main:visible input[name="kid"][value="${zoe._id}"]`).isChecked()) && (await page.inputValue('main:visible [name="other"]')) === "5000");

  // 4. $10 → Stripe's embedded form.
  await page.check('main:visible input[name="amount"][value="1000"]');
  await page.locator("main:visible button[type=submit]").click();
  await page.locator('[data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 60_000 });
  check("$10 bonus opens Stripe's embedded form", ((await page.locator('[data-testid="stripe-checkout"] iframe').first().getAttribute("src")) ?? "").startsWith("https://js.stripe.com/"));

  // 5. Server refuses other families' kids and unregistered kids (direct service calls = forged form posts).
  const origin = base;
  const r1 = await startBonus(parentA, String(other._id), 1000, origin, (p) => p);
  const r2 = await startBonus(parentA, String(leo._id), 1000, origin, (p) => p);
  const r3 = await startBonus(parentA, String(maya._id), null, origin, (p) => p);
  check("server: another family's kid / unregistered kid / bad amount all refused",
    !r1.ok && r1.error === "notFound" && !r2.ok && r2.error === "notFound" && !r3.ok && r3.error === "amount");

  // 6. Paid (signed webhook) → points for THAT kid only, ledger row "earn_bonus".
  const piId = `pi_e2ebon${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2ebon${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const md = buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: String(zoe._id), sos_family_id: String(A.family._id) });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: 1000, amount_received: 1000, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  const [z, m, tx] = await Promise.all([Kid.findById(zoe._id).lean(), Kid.findById(maya._id).lean(), Transaction.findOne({ stripePaymentIntentId: piId }).lean()]);
  check("$10 bonus → 6.66 points for Zoe only, ledger 'earn_bonus'", z?.availableCentipoints === 666 && m?.availableCentipoints === 0 && tx?.type === "earn_bonus");

  // 7. Return page: an unpaid real session of THIS family → "not completed"; unknown → "couldn't find".
  const s = await getStripe().checkout.sessions.create({
    ui_mode: "embedded_page", mode: "payment", metadata: md, return_url: `${base}/parent/bonus/return?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 500, product_data: { name: "E2E bonus" } } }],
  });
  sessionIds.push(s.id);
  check("return page: unpaid session → 'wasn't completed'", (await mainText(`${base}/parent/bonus/return?session_id=${s.id}`)).includes("wasn't completed"));
  check("return page: unknown session → not found", (await mainText(`${base}/parent/bonus/return?session_id=cs_test_${"z".repeat(20)}`)).includes("couldn't find"));
  const sB = await getStripe().checkout.sessions.create({
    ui_mode: "embedded_page", mode: "payment", return_url: `${base}/x?session_id={CHECKOUT_SESSION_ID}`,
    metadata: buildPaymentMetadata({ sos_purpose: "bonus", sos_kid_id: String(other._id), sos_family_id: String(B.family._id) }),
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 500, product_data: { name: "E2E bonus B" } } }],
  });
  sessionIds.push(sB.id);
  check("return page: another family's session → not found", (await mainText(`${base}/parent/bonus/return?session_id=${sB.id}`)).includes("couldn't find"));

  // 8. Spanish.
  check("Spanish bonus page", (await mainText(`${base}/es/parent/bonus`)).includes("Magia extra"));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  for (const id of sessionIds) await getStripe().checkout.sessions.expire(id).catch(() => undefined);
  const fams = [A.family._id, B.family._id];
  const users = [A.user._id, B.user._id];
  await Transaction.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } });
  await RateLimit.collection.deleteMany({ key: trusted({ $in: users.map((u) => `bonus-start:${u}`) }) });
  await Kid.collection.deleteMany({ familyId: { $in: fams } });
  await AuditLog.collection.deleteMany({ actorUserId: { $in: users } });
  await Family.collection.deleteMany({ _id: { $in: fams } });
  await User.collection.deleteMany({ _id: { $in: users } });
  await mongoose.disconnect();
}
process.exit(report());
