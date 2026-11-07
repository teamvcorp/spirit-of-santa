/**
 * Real-browser E2E (Edge) for Phase 4 slice 6: a kid's shareable donation link/QR (no deed).
 *
 *   (from apps/family) NEXTAUTH_URL=http://localhost:3016 node ../../node_modules/next/dist/bin/next start -p 3016
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-donate.ts http://localhost:3016
 *
 * Needs the season open or frozen today. Creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, Kid, Payment, StripeEvent, Transaction, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { hashDeedToken } from "@repo/deeds/qr";
import { buildPaymentMetadata, getStripe } from "@repo/payments/checkout";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-donate.ts <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `donate pass ${tag}`;
const PIN = "8152";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const user = await User.create({ email: `e2e-don-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Secretfam${tag}`, alias: "Snow Crew", showAliasPublicly: true, aliasReview: "approved", parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
const maya = await Kid.create({ familyId: fam._id, firstName: `Mayafirst${tag}`, birthYear: 2017, displayName: "M.", registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const leo = await Kid.create({ familyId: fam._id, firstName: "Leo", birthYear: 2018, displayName: "L." });
const piIds: string[] = [];
const evtIds: string[] = [];
const sessionIds: string[] = [];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const linkOnKidPage = async () => {
  await page.goto(`${base}/kids/${maya._id}`);
  const img = page.locator("main img[data-donate-url]");
  await img.waitFor({ timeout: 15_000 });
  return (await img.getAttribute("data-donate-url")) ?? "";
};
const visit = async (p: Page, url: string) => {
  await p.goto(url);
  await p.locator("main h1, main [role=alert]").first().waitFor({ timeout: 15_000 });
  return p.locator("main").innerText();
};

try {
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });

  // 1. Kid page shows the donation QR + link; only the hash is stored.
  const url1 = await linkOnKidPage();
  const token1 = url1.split("/k/")[1] ?? "";
  const stored = await Kid.findById(maya._id).select("+donationTokenHash").lean();
  check("registered kid's page shows a donation QR + /k/<token> link", url1.startsWith(`${base}/k/`) && token1.length === 43);
  check("only the link's hash is stored", stored?.donationTokenHash === hashDeedToken(token1) && !JSON.stringify(stored).includes(token1));
  await page.goto(`${base}/kids/${leo._id}`);
  await page.locator("main h1").waitFor({ timeout: 15_000 });
  check("unregistered kid: no donation link", (await page.locator("main img[data-donate-url]").count()) === 0);

  // 2. A stranger: display name + nickname only; bad amount refused; $10 opens Stripe.
  const stranger = await (await browser.newContext()).newPage();
  stranger.on("pageerror", (e) => errors.push(e.message));
  const txt = await visit(stranger, url1);
  check("public donation page: display name + approved nickname, never the first or family name",
    txt.includes("Give to M.") && txt.includes("Snow Crew") && !(await stranger.content()).includes(`Mayafirst${tag}`) && !(await stranger.content()).includes(`Secretfam${tag}`));
  await hydrated(stranger);
  await stranger.check('main input[name="amount"][value="other"]');
  await stranger.fill('main [name="other"]', "2000");
  await stranger.locator("main button[type=submit]").click();
  await stranger.locator("main").getByText("Choose an amount between").waitFor({ timeout: 15_000 });
  check("over-$1,000 gift refused by the server", true);
  await hydrated(stranger);
  await stranger.check('main input[name="amount"][value="1000"]');
  await stranger.locator("main button[type=submit]").click();
  await stranger.locator('[data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 30_000 }).catch(async (e) => { console.error("PAGE:", await stranger.locator("main").innerText()); throw e; });
  check("$10 gift opens Stripe's embedded form", ((await stranger.locator('[data-testid="stripe-checkout"] iframe').first().getAttribute("src")) ?? "").startsWith("https://js.stripe.com/"));

  // 3. Payment (signed webhook, tip without a deed) → points.
  const piId = `pi_e2edon${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2edon${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const md = buildPaymentMetadata({ sos_purpose: "tip", sos_kid_id: String(maya._id), sos_family_id: String(fam._id) });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: 1000, amount_received: 1000, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  check("$10 gift → 6.66 points for the kid", (await Kid.findById(maya._id).lean())?.availableCentipoints === 666);
  check("thanks page never claims success for an unknown session", (await visit(stranger, `${url1}/thanks?session_id=cs_test_${"z".repeat(20)}`)).includes("isn't valid"));

  // 4. "Make a new link": needs the PIN; then the old link dies, the new one works.
  // A donor's checkout started from the OLD link before the reset (real Stripe test session).
  const early = await getStripe().checkout.sessions.create({
    ui_mode: "embedded_page", mode: "payment", metadata: md, return_url: `${url1}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 500, product_data: { name: "E2E early donation" } } }],
  });
  sessionIds.push(early.id);
  await page.goto(`${base}/kids/${maya._id}`);
  await hydrated(page);
  await page.locator("main button", { hasText: "Make a new link" }).click();
  await page.locator("main").getByText("Enter the parent PIN first").waitFor({ timeout: 15_000 });
  check("replacing the link without the PIN is refused", (await Kid.findById(maya._id).lean())?.donationLinkVersion === 1);
  await page.goto(`${base}/parent/pin`);
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 15_000 });
  await page.goto(`${base}/kids/${maya._id}`);
  await hydrated(page);
  await page.locator("main button", { hasText: "Make a new link" }).click();
  await page.locator("main").getByText("New link made").waitFor({ timeout: 15_000 });
  const url2 = await linkOnKidPage();
  check("new link is different; change audited", url2 !== url1 && (await AuditLog.countDocuments({ actorUserId: user._id, action: "kid.donation_link_reset" })) === 1);
  check("old link no longer works", (await visit(stranger, url1)).includes("isn't valid"));
  check("new link works", (await visit(stranger, url2)).includes("Give to M."));
  check("old link's thanks page still knows a checkout started before the reset (not 'invalid')",
    (await visit(stranger, `${url1}/thanks?session_id=${early.id}`)).includes("wasn't completed"));

  // 5. Spanish.
  const es = await (await browser.newContext()).newPage();
  await es.goto(url2.replace("/k/", "/es/k/"));
  await es.locator("main h1").waitFor({ timeout: 15_000 });
  check("Spanish donation page", (await es.locator("main").innerText()).includes("Haz un regalo para la lista de deseos de M."));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  for (const id of sessionIds) await getStripe().checkout.sessions.expire(id).catch(() => undefined);
  await Transaction.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } });
  await Kid.collection.deleteMany({ familyId: fam._id });
  await AuditLog.collection.deleteMany({ actorUserId: user._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteOne({ _id: user._id });
  await mongoose.disconnect();
}
process.exit(report());
