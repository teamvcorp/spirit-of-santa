/**
 * Real-browser E2E (Edge) for Phase 4 slice 2b: $5 child registration (Stripe Embedded Checkout)
 * + the family promo code + webhook fulfilment.
 *
 *   (from apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-register.ts http://localhost:3016
 *
 * Uses Stripe TEST keys (creates real test-mode Checkout Sessions). The card itself isn't typed
 * here: the payment's success is delivered the way Stripe does, as a SIGNED webhook event
 * (same technique as stripe-webhook.ts). Needs FAMILY_PROMO_CODE in apps/family/.env.local.
 * Creates and removes its own parents, families, kids, payments and webhook records.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, Kid, Payment, RateLimit, StripeEvent, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { buildPaymentMetadata } from "@repo/payments/checkout";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-register.ts <familyUrl>");
/* eslint-disable turbo/no-undeclared-env-vars */
const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const PROMO = process.env.FAMILY_PROMO_CODE ?? "";
/* eslint-enable turbo/no-undeclared-env-vars */
if (!secret.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
if (!PROMO) throw new Error("FAMILY_PROMO_CODE missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `register pass ${tag}`;
const PIN = "5173";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
async function family(n: string, kidNames: string[]) {
  const u = await User.create({ email: `e2e-reg-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const f = await Family.create({ ownerUserId: u._id, familyName: `Reg ${n}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date(), emailVerifiedAt: new Date() } });
  await User.updateOne({ _id: u._id }, { $set: { familyId: f._id } });
  const kids = await Kid.insertMany(kidNames.map((k) => ({ familyId: f._id, firstName: k, birthYear: 2017, displayName: `${k[0]}.` })));
  return { user: u, family: f, kids };
}
const A = await family("a", ["Ann", "Ben"]);
const B = await family("b", ["Cal", "Dee"]);

const rid = () => randomBytes(6).toString("hex");
const piIds: string[] = [];
const eventIds: string[] = [];
async function sendSucceeded(md: Record<string, string>, amount: number) {
  const piId = `pi_e2ereg${rid()}`;
  const evtId = `evt_e2ereg${rid()}`;
  piIds.push(piId);
  eventIds.push(evtId);
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now,
    data: { object: { id: piId, object: "payment_intent", amount, amount_received: amount, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } },
  });
  const res = await fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) },
    body,
  });
  return { status: res.status, piId };
}
const regMd = (fam: typeof A, kidIds: unknown[], promo: "0" | "1") =>
  buildPaymentMetadata({ sos_purpose: "registration", sos_family_id: String(fam.family._id), sos_kid_ids: kidIds.map(String).join(","), sos_promo: promo });
const kid = (id: unknown) => Kid.findById(id).lean();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
async function signedInUnlocked(fam: typeof A) {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${base}/signin`);
  await hydrated(p);
  await p.fill('[name="email"]', fam.user.email);
  await p.fill('[name="password"]', PW);
  await p.click("main button[type=submit]");
  await p.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
  await p.goto(`${base}/parent/pin`);
  await hydrated(p);
  await p.fill('[name="pin"]', PIN);
  await p.click("main button[type=submit]");
  await p.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  return p;
}
async function submitRegister(p: Page, promo = "") {
  await p.goto(`${base}/parent/register`);
  await hydrated(p);
  if (promo) await p.fill('[name="promo"]', promo);
  await p.locator("main button[type=submit]").click();
}

try {
  // 1. Dashboard offers registration; a wrong promo code is refused.
  const pa = await signedInUnlocked(A);
  // The dashboard streams in (Suspense): wait for the button itself.
  const shown = await pa.locator('main a[href$="/parent/register"]').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("dashboard shows 'Register children' while kids are awaiting", shown);
  await submitRegister(pa, "not-a-code");
  await pa.locator("main").getByText("promo code isn't valid").waitFor({ timeout: 15_000 });
  check("wrong promo code refused", true);

  // 2. No promo, 2 kids → Stripe's embedded form appears, $10.00.
  await submitRegister(pa);
  await pa.locator('[data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 30_000 });
  const src = await pa.locator('[data-testid="stripe-checkout"] iframe').first().getAttribute("src");
  check("Stripe Embedded Checkout loads in the page (js.stripe.com iframe), total $10.00",
    (src ?? "").startsWith("https://js.stripe.com/") && (await pa.locator("main").innerText()).includes("$10.00"), src ?? "");

  // 3. Webhook: wrong amount → flagged, nothing registered; right amount → both registered.
  const bad = await sendSucceeded(regMd(A, A.kids.map((k) => k._id), "0"), 500);
  check("payment for the wrong amount: flagged for review, kids stay awaiting",
    bad.status === 200 && (await Payment.findOne({ stripePaymentIntentId: bad.piId }).lean())?.fulfilment === "review" &&
      (await kid(A.kids[0]!._id))?.registration?.status === "awaiting");
  const good = await sendSucceeded(regMd(A, A.kids.map((k) => k._id), "0"), 1000);
  const [a0, a1] = [await kid(A.kids[0]!._id), await kid(A.kids[1]!._id)];
  const goodPay = await Payment.findOne({ stripePaymentIntentId: good.piId }).lean();
  check("$10 payment → both kids registered by card, payment 'fulfilled', no points",
    a0?.registration?.status === "registered" && a1?.registration?.method === "card" && goodPay?.fulfilment === "fulfilled" && a0.availableCentipoints === 0);
  const again = await sendSucceeded(regMd(A, A.kids.map((k) => k._id), "0"), 1000);
  check("paying again for already-registered kids is flagged (double payment), not silently kept",
    (await Payment.findOne({ stripePaymentIntentId: again.piId }).lean())?.fulfilment === "review");

  // 3b. Paid for 2 kids but one was meanwhile registered: the other IS registered, money → review.
  const k3 = await Kid.create({ familyId: A.family._id, firstName: "Dot", birthYear: 2018, displayName: "D." });
  const partial = await sendSucceeded(regMd(A, [k3._id, A.kids[0]!._id], "0"), 1000);
  const pp = await Payment.findOne({ stripePaymentIntentId: partial.piId }).lean();
  check("paid for 2 but only 1 still awaiting: that one registered by card, payment flagged for review",
    (await kid(k3._id))?.registration?.method === "card" && pp?.fulfilment === "review" && /1 of 2/.test(pp.reviewReason ?? ""));

  // 4. A payment labelled for another family's kid doesn't register it.
  const cross = await sendSucceeded(regMd(A, [B.kids[0]!._id], "0"), 500);
  check("kid of another family isn't registered by this family's payment",
    cross.status === 200 && (await kid(B.kids[0]!._id))?.registration?.status === "awaiting");

  // 5. Promo + family ALREADY paid by card → a new child is registered free, right away.
  const extra = await Kid.create({ familyId: A.family._id, firstName: "Cora", birthYear: 2019, displayName: "C." });
  await submitRegister(pa, PROMO.toUpperCase());
  await pa.locator("main").getByText("registered with your promo code").waitFor({ timeout: 15_000 });
  const cora = await kid(extra._id);
  check("promo (any case) after a card payment: registered free, method 'promo', audited",
    cora?.registration?.status === "registered" && cora.registration.method === "promo" &&
      (await AuditLog.countDocuments({ actorUserId: A.user._id, action: "kid.register_promo" })) === 1);

  // 5b. A family whose only "payment" was flagged (never verified consent) can't use the free path.
  const flaggedPi = `pi_e2eflag${rid()}`;
  piIds.push(flaggedPi);
  await Payment.create({ stripePaymentIntentId: flaggedPi, livemode: false, purpose: "registration", status: "succeeded", seasonYear: 2026, familyId: B.family._id, amountCents: 500, currency: "usd", fulfilment: "review" });

  // 6. Promo for a family that never paid: ONE $5 covers both kids (consent still card-verified).
  const pb = await signedInUnlocked(B);
  await submitRegister(pb, PROMO);
  await pb.locator('[data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 30_000 });
  check("promo for a family with only a FLAGGED payment still needs a card: Stripe form, $5.00 for 2 kids",
    (await pb.locator("main").innerText()).includes("$5.00") && (await kid(B.kids[0]!._id))?.registration?.status === "awaiting");
  await sendSucceeded(regMd(B, B.kids.map((k) => k._id), "1"), 500);
  const [b0, b1] = [await kid(B.kids[0]!._id), await kid(B.kids[1]!._id)];
  check("$5 promo payment → first kid 'card', second 'promo'", b0?.registration?.method === "card" && b1?.registration?.method === "promo");

  // 7. Return page never trusts a made-up session id.
  await pb.goto(`${base}/parent/register/return?session_id=cs_test_${"x".repeat(20)}`);
  await pb.locator("main").getByText("couldn't find that payment").waitFor({ timeout: 15_000 });
  check("return page with an unknown session: 'couldn't find', no claim of success", true);

  // 8. Spanish.
  await pb.goto(`${base}/es/parent/register`);
  await pb.locator("main h1").filter({ hasText: "Registra a tus hijos" }).waitFor({ timeout: 15_000 });
  check("Spanish registration page", true);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const users = [A.user._id, B.user._id];
  const fams = [A.family._id, B.family._id];
  await Kid.collection.deleteMany({ familyId: { $in: fams } });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: eventIds } });
  await AuditLog.collection.deleteMany({ actorUserId: { $in: users } });
  await RateLimit.collection.deleteMany({ key: trusted({ $in: users.map((u) => `pin-set:${u}`) }) });
  await Family.collection.deleteMany({ _id: { $in: fams } });
  await User.collection.deleteMany({ _id: { $in: users } });
  await mongoose.disconnect();
}
process.exit(report());
