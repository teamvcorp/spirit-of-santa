/**
 * Real-browser E2E (Edge) for Phase 4 slice 4: the PUBLIC deed page behind a QR code
 * (/d/<token>: thank you + tips) and the admin "Other" text review (/moderation).
 *
 *   family: (apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *   admin:  (apps/admin)  NEXTAUTH_URL=http://localhost:3014 node ../../node_modules/next/dist/bin/next start -p 3014
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *        scripts/e2e/browser-qr-page.ts http://localhost:3016 http://localhost:3014
 * (admin env: MFA_ENCRYPTION_KEY for the test admin; family env: DEED_QR_KEY + Stripe test keys.)
 * Needs the season open or frozen today. Creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Deed, DeedType, Family, Kid, Payment, StripeEvent, Transaction, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { deedToken, hashDeedToken } from "@repo/deeds/qr";
import { getSeasonYear } from "@repo/lib/season";
import { buildPaymentMetadata } from "@repo/payments/checkout";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base, adminBase] = process.argv.slice(2);
if (!base || !adminBase) throw new Error("usage: browser-qr-page.ts <familyUrl> <adminUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const parent = await User.create({ email: `e2e-qr-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(`qr pass ${tag}`), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: parent._id, familyName: `Secretname${tag}`, alias: "Elves", showAliasPublicly: true, consent: { version: "test", acceptedAt: new Date() } });
const reg = { status: "registered", registeredAt: new Date(), method: "card" };
const maya = await Kid.create({ familyId: fam._id, firstName: `Mayafirst${tag}`, birthYear: 2017, displayName: "M.", registration: reg });
const leo = await Kid.create({ familyId: fam._id, firstName: "Leo", birthYear: 2018, displayName: "L." });
const type = await DeedType.create({ title: { en: `Raked leaves ${tag}`, es: `Rastrillé hojas ${tag}` }, active: true });
const year = getSeasonYear();
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
async function deed(kidId: unknown, extra: Record<string, unknown>) {
  const _id = new mongoose.Types.ObjectId();
  const token = deedToken(String(_id));
  await Deed.collection.insertOne({ _id, kidId, familyId: fam._id, seasonYear: year, locale: "en", status: "pending", qrTokenHash: hashDeedToken(token), expiresAt: days(7), createdAt: new Date(), updatedAt: new Date(), ...extra });
  return { id: _id, token };
}
const dType = await deed(maya._id, { deedTypeId: type._id });
const dPendingText = await deed(maya._id, { customDescription: `Helped Mrs ${tag} on Elm Street`, customReview: "pending" });
const dApproved = await deed(maya._id, { customDescription: "Helped at the library", customReview: "approved" });
const dHide = await deed(maya._id, { customDescription: `Walked ${tag} dog`, customReview: "pending" });
const dExpired = await deed(maya._id, { deedTypeId: type._id, expiresAt: days(-1) });
const dLeo = await deed(leo._id, { deedTypeId: type._id });
const piIds: string[] = [];
const evtIds: string[] = [];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage(); // a stranger: never signed in
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const open = async (token: string, lang = "") => {
  await page.goto(`${base}${lang}/d/${token}`);
  await page.locator("main h1, main [role=alert], main [role=status]").first().waitFor({ timeout: 15_000 });
  return page.locator("main").innerText();
};

try {
  // 1. What a stranger sees: display name + alias + deed; never the first or family name.
  const txt = await open(dType.token);
  const html = await page.content();
  check("public page: display name, family alias, deed title", txt.includes("M. did a good deed") && txt.includes("Elves") && txt.includes(`Raked leaves ${tag}`));
  check("public page never contains the first name or the private family name", !html.includes(`Mayafirst${tag}`) && !html.includes(`Secretname${tag}`));
  // Separate browser: visiting /es saves a language cookie that would make later visits Spanish.
  const esPage = await (await browser.newContext()).newPage();
  await esPage.goto(`${base}/es/d/${dType.token}`);
  await esPage.locator("main h1").waitFor({ timeout: 15_000 });
  check("Spanish visitor sees the Spanish deed title", (await esPage.locator("main").innerText()).includes(`Rastrillé hojas ${tag}`));
  await esPage.context().close();

  // 2. "Other" text: hidden until approved.
  check("unapproved 'Other' text is NOT shown ('A good deed' instead)", (await open(dPendingText.token)).includes("A good deed") && !(await page.content()).includes("Elm Street"));
  check("approved 'Other' text is shown", (await open(dApproved.token)).includes("Helped at the library"));

  // 3. Bad codes.
  check("made-up code → not valid", (await open("x".repeat(43))).includes("isn't valid"));
  check("expired code → expired", (await open(dExpired.token)).includes("expired"));
  check("unregistered kid's code → not valid (never public)", (await open(dLeo.token)).includes("isn't valid"));

  // 4. Say thank you → confirmed, single use.
  await open(dType.token);
  await hydrated(page);
  await page.locator("main button", { hasText: "Say thank you" }).click();
  await page.locator("main").getByText("so happy to hear it").waitFor({ timeout: 15_000 });
  const thanked = await Deed.findById(dType.id).lean();
  check("thank you → deed confirmed (outcome thanked), QR used, no points",
    thanked?.status === "confirmed" && thanked.outcome === "thanked" && !!thanked.qrUsedAt && (await Kid.findById(maya._id).lean())?.availableCentipoints === 0);
  check("scanning again → 'already thanked'", (await open(dType.token)).includes("already thanked"));
  // A tip that arrives for an already-thanked deed (two visitors at once): points credited, the
  // FIRST confirmation ("thanked") stands.
  const late = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: String(maya._id), sos_family_id: String(fam._id), sos_deed_id: String(dType.id) });
  const lateId = `pi_e2eqrlate${randomBytes(6).toString("hex")}`;
  const lateEvt = `evt_e2eqrlate${randomBytes(6).toString("hex")}`;
  piIds.push(lateId);
  evtIds.push(lateEvt);
  const t0 = Math.floor(Date.now() / 1000);
  const lateBody = JSON.stringify({ id: lateEvt, object: "event", type: "payment_intent.succeeded", livemode: false, created: t0, data: { object: { id: lateId, object: "payment_intent", amount: 500, amount_received: 500, currency: "usd", status: "succeeded", livemode: false, metadata: late, created: t0 } } });
  await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: lateBody, secret: whsec }) }, body: lateBody });
  check("a tip for an already-thanked deed: points credited, outcome stays 'thanked'",
    (await Kid.findById(maya._id).lean())?.availableCentipoints === 333 && (await Deed.findById(dType.id).lean())?.outcome === "thanked");

  // 5. Tips: bad amount refused; $10 → Stripe form; signed webhook → points + deed paid.
  await open(dApproved.token);
  await hydrated(page);
  await page.check('main input[name="amount"][value="other"]');
  await page.fill('main [name="other"]', "0.50");
  await page.locator("main button", { hasText: "Continue to payment" }).click();
  await page.locator("main").getByText("Choose an amount between").waitFor({ timeout: 15_000 });
  check("tip below $1 refused by the server", true);
  await hydrated(page);
  await page.check('main input[name="amount"][value="1000"]');
  await page.locator("main button", { hasText: "Continue to payment" }).click();
  await page.locator('[data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 30_000 });
  check("$10 tip opens Stripe's embedded form (js.stripe.com), QR not used up yet",
    ((await page.locator('[data-testid="stripe-checkout"] iframe').first().getAttribute("src")) ?? "").startsWith("https://js.stripe.com/") &&
      !(await Deed.findById(dApproved.id).lean())?.qrUsedAt);
  const piId = `pi_e2eqr${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2eqr${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const md = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: String(maya._id), sos_family_id: String(fam._id), sos_deed_id: String(dApproved.id) });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: 1000, amount_received: 1000, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  const paid = await Deed.findById(dApproved.id).lean();
  check("paid tip → +6.66 points (9.99 total), deed confirmed 'paid', QR used",
    (await Kid.findById(maya._id).lean())?.availableCentipoints === 999 && paid?.status === "confirmed" && paid.outcome === "paid" && !!paid.qrUsedAt);
  check("scanning a tipped deed → 'already received a tip'", (await open(dApproved.token)).includes("already received a tip"));
  await page.goto(`${base}/d/${dApproved.token}/thanks?session_id=cs_test_${"y".repeat(20)}`);
  await page.locator("main [role=alert]").first().waitFor({ timeout: 15_000 });
  check("thanks page never claims success for an unknown session", (await page.locator("main").innerText()).includes("isn't valid"));

  // 6. Admin review: approve one text, hide another; the public page follows.
  const admin = await createMfaAdmin(`e2e-qr-admin-${tag}@spiritofsanta.test`);
  const ap = await (await browser.newContext()).newPage();
  ap.on("pageerror", (e) => errors.push(e.message));
  await ap.goto(`${adminBase}/signin`);
  await hydrated(ap);
  await ap.fill('[name="email"]', admin.email);
  await ap.fill('[name="password"]', admin.password);
  await ap.fill('[name="code"]', await admin.nextCode());
  await ap.click("main button[type=submit]");
  await ap.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
  await ap.goto(`${adminBase}/`);
  await ap.locator("main").getByText(/deed texts? waiting for review/).first().waitFor({ timeout: 15_000 });
  check("dashboard shows deed texts waiting for review", true);
  await ap.goto(`${adminBase}/moderation`);
  const list = ap.locator('[data-testid="moderation-list"]');
  await list.waitFor({ timeout: 15_000 });
  check("review queue lists pending texts only (no child or family names)",
    (await list.innerText()).includes("Elm Street") && !(await list.innerText()).includes("library") && !(await ap.content()).includes(`Mayafirst${tag}`));
  await hydrated(ap);
  await ap.locator("main li", { hasText: "Elm Street" }).locator("button", { hasText: "Approve" }).click();
  for (let i = 0; i < 30 && (await Deed.findById(dPendingText.id).lean())?.customReview === "pending"; i++) await ap.waitForTimeout(300);
  await hydrated(ap);
  await ap.locator("main li", { hasText: `Walked ${tag}` }).locator("button", { hasText: "Hide" }).click();
  for (let i = 0; i < 30 && (await Deed.findById(dHide.id).lean())?.customReview === "pending"; i++) await ap.waitForTimeout(300);
  check("approve/hide saved and audited",
    (await Deed.findById(dPendingText.id).lean())?.customReview === "approved" && (await Deed.findById(dHide.id).lean())?.customReview === "rejected" &&
      (await AuditLog.countDocuments({ actorUserId: new mongoose.Types.ObjectId(admin.id), action: "deed.text_review" })) === 2);
  check("public page now shows the approved text", (await open(dPendingText.token)).includes("Elm Street"));
  check("…and still hides the hidden one", (await open(dHide.token)).includes("A good deed"));
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await User.collection.deleteOne({ _id: new mongoose.Types.ObjectId(admin.id) });

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  await Deed.collection.deleteMany({ familyId: fam._id });
  await Transaction.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } });
  await Kid.collection.deleteMany({ familyId: fam._id });
  await DeedType.collection.deleteOne({ _id: type._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteOne({ _id: parent._id });
  await mongoose.disconnect();
}
process.exit(report());
