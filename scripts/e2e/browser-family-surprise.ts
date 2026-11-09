/**
 * E2E for SURPRISE gifts (owner 2026-11-08): a parent adds a store item the child sees only as a wrapped gift, and
 * may "fund it now" by card ($1.50 per Christmas Magic, the pay-up checkout) while the season is open.
 * Engine rules are called directly; the pages run in a real browser (Edge); the payment goes through the dev
 * server's SIGNED webhook.
 *
 *   family dev server on :3000 (restart after model changes), season OPEN, then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-surprise.ts http://localhost:3000
 *
 * *_dev database only; creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { connectDb, Family, Item, Kid, Payment, RateLimit, Store, StripeEvent, Transaction, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { startPayUp } from "@repo/families/payup";
import { getSeasonYear } from "@repo/lib/season";
import { buildPaymentMetadata } from "@repo/payments/checkout";
import { getSeasonState } from "@repo/stores/season";
import { addSurprise, addToList, removeFromList } from "@repo/wishlists/engine";
import { ledgerProblems } from "@repo/wishlists/ledger-check";
import { payUpCents } from "@repo/wishlists/payup";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-surprise.ts <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `surprise pass ${tag}`;
const PIN = "8162";
const year = getSeasonYear();

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
if ((await getSeasonState()).phase !== "open") throw new Error("the season must be OPEN for this test");
const oid = () => new mongoose.Types.ObjectId();

const user = await User.create({ email: `e2e-surprise-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Surp${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
// 0 Christmas Magic and a gift limit of 2: shows a surprise needs no Magic and counts toward the limit.
const kid = await Kid.create({ familyId: fam._id, firstName: `Ava${tag}`, birthYear: 2017, displayName: "A.", itemCap: 2, availableCentipoints: 0, escrowedCentipoints: 0, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const parent = { id: String(user._id), familyId: String(fam._id) };
const storeId = oid();
await Store.collection.insertOne({ _id: storeId, name: `Secret Shop ${tag}`, slug: `e2e-surprise-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
const mkItem = async (name: string, priceCents: number) => {
  const _id = oid();
  await Item.collection.insertOne({ _id, storeId, seasonYear: year, name: `${name}${tag}`, priceCents, inventory: 3, status: "active", createdAt: new Date(), updatedAt: new Date() });
  return String(_id);
};
const DRONE = `Drone${tag}`;
const KITE = `Kite${tag}`;
const drone = await mkItem("Drone", 2000);
const kite = await mkItem("Kite", 500);
const drone2 = await mkItem("Robot", 700);
const kid2 = await Kid.create({ familyId: fam._id, firstName: `Bo${tag}`, birthYear: 2018, displayName: "B.", itemCap: 1, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const piIds: string[] = [];
const evtIds: string[] = [];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const ledgerOk = async () => {
  const k = await Kid.findById(kid._id).lean();
  return ledgerProblems(k!, await Transaction.find({ kidId: kid._id }).lean(), await WishListItem.find({ kidId: kid._id }).select("status fundedCentipoints").lean());
};

try {
  // 1. Engine rules.
  const kidAdd = await addToList(parent, String(kid._id), kite);
  check("control: the CHILD can't add with 0 Christmas Magic", !kidAdd.ok && kidAdd.error === "noPoints");
  const s1 = await addSurprise(parent, String(kid._id), drone);
  check("a parent's surprise needs no Christmas Magic", s1.ok);
  const surpriseId = s1.ok ? s1.wishListItemId : "";
  check("stored as a surprise", (await WishListItem.findById(surpriseId).lean())?.surprise === true);
  const again = await addSurprise(parent, String(kid._id), drone);
  check("the same surprise twice is refused", !again.ok && again.error === "alreadyListed");
  // The child may list the same item themselves: "already on your list" would give the surprise away.
  await Kid.updateOne({ _id: kid._id }, { $inc: { availableCentipoints: 100 } });
  await Transaction.create({ kidId: kid._id, familyId: fam._id, seasonYear: year, type: "adjustment_credit", amountCentipoints: 100, note: "e2e setup" });
  const own = await addToList(parent, String(kid._id), drone);
  check("the child can still add that same item (the surprise isn't revealed)", own.ok);
  const capped = await addSurprise(parent, String(kid._id), kite);
  check("a surprise counts toward the gift limit (2 of 2: refused)", !capped.ok && capped.error === "cap");
  check("oldest-first: the earlier surprise got the child's 1 Christmas Magic", (await WishListItem.findById(surpriseId).lean())?.fundedCentipoints === 100);
  if (own.ok) {
    const rm = await removeFromList(parent, own.wishListItemId);
    check("the child's own copy can be removed again", rm.ok);
  }
  check("ledger consistent after adds/removes", (await ledgerOk()).length === 0, (await ledgerOk()).join("; "));
  // Race (review of 38e9eab): three surprises at the SAME moment for a child with 0 Magic and a limit of 1.
  const race = await Promise.all([drone, kite, drone2].map((it) => addSurprise(parent, String(kid2._id), it)));
  check("3 surprises at once with a limit of 1: exactly one is added", race.filter((r) => r.ok).length === 1 && (await WishListItem.countDocuments({ kidId: kid2._id })) === 1, JSON.stringify(race.map((r) => (r.ok ? "ok" : r.error))));

  // 2. Fund it now: allowed for a surprise while the season is open, not for a child's own wish.
  // (The removed copy's Christmas Magic flowed back into the surprise, oldest first: give the child 1 more to add.)
  await Kid.updateOne({ _id: kid._id }, { $inc: { availableCentipoints: 100 } });
  await Transaction.create({ kidId: kid._id, familyId: fam._id, seasonYear: year, type: "adjustment_credit", amountCentipoints: 100, note: "e2e setup" });
  const ownAgain = await addToList(parent, String(kid._id), kite);
  check("(setup) the child adds a Kite of their own", ownAgain.ok, JSON.stringify(ownAgain));
  if (ownAgain.ok) {
    const notSurprise = await startPayUp(parent, ownAgain.wishListItemId, base, (p) => p);
    check("a child's own wish can't be paid off before December (pay-up window only)", !notSurprise.ok && notSurprise.error === "windowClosed");
    await removeFromList(parent, ownAgain.wishListItemId);
  }
  // Released Christmas Magic keeps flowing into the surprise (oldest first): read what it still needs.
  const before = (await WishListItem.findById(surpriseId).lean())!;
  const missing = before.costCentipoints - before.fundedCentipoints;
  const cents = payUpCents(missing);
  const dollars = `$${(cents / 100).toFixed(2)}`;
  const fund = await startPayUp(parent, surpriseId, base, (p) => p, (k) => `/kids/${k}/surprise/return`);
  check(`a surprise can be paid off now, at $1.50 per missing Christmas Magic (${missing / 100} → ${dollars})`, fund.ok && fund.amountCents === cents && cents === Math.ceil((missing * 150) / 100), fund.ok ? `amount ${fund.amountCents}` : fund.error); // never print the client secret

  // 3. The child's pages: a wrapped gift, never the name (not even in the page data).
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/kids/${kid._id}`);
  await page.locator('main:visible [data-testid="wish-list"]').waitFor({ timeout: 60_000 });
  const kidHtml = await page.content();
  const row = page.locator('main:visible [data-surprise="true"]');
  check("child's page: the surprise shows as 'A surprise!' with the wrapped-gift picture", (await row.innerText()).includes("A surprise!") && (await row.locator('img[src*="gift-box.svg"]').count()) === 1);
  check("child's page HTML (incl. React data) never contains the gift's or store's name", !kidHtml.includes(DRONE) && !kidHtml.includes(`Secret Shop ${tag}`) && !kidHtml.includes(drone));
  check("child's page: no link to the hidden gift", (await row.locator("a[href*='/gifts/']").count()) === 0);
  await page.goto(`${base}/kids/${kid._id}/gifts/${drone}`);
  await page.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  check("gift page of the same item doesn't say 'already on the wish list'", !(await page.locator("main:visible").innerText()).includes("already on the wish list"));

  // 4. The parent's surprise page: PIN, the real gift, Fund it now, add another.
  await page.goto(`${base}/kids/${kid._id}/surprise`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin") && u.searchParams.get("next") === `/kids/${kid._id}/surprise`, { timeout: 60_000 });
  check("surprise page needs the parent PIN (and comes back after)", true);
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith(`/kids/${kid._id}/surprise`), { timeout: 60_000 });
  const list = page.locator('main:visible [data-testid="surprise-list"]');
  await list.waitFor({ timeout: 60_000 });
  check("parent sees the real gift and the price to fund it now", (await list.innerText()).includes(DRONE) && (await list.innerText()).includes(`Fund it now: ${dollars}`), await list.innerText());
  check("quiet rate note names $1.50", (await page.locator('main:visible [data-testid="surprise-rate"]').innerText()).includes("$1.50"));
  await hydrated(page);
  await list.getByRole("button", { name: `Fund ${DRONE} now` }).click();
  await page.locator('main:visible [data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 60_000 });
  check("'Fund it now' opens Stripe's form", true);
  await page.goto(`${base}/kids/${kid._id}/surprise/${kite}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Add as a surprise" }).click();
  await page.locator("main:visible [role=status]").filter({ hasText: "Added!" }).waitFor({ timeout: 60_000 });
  const kiteRow = await WishListItem.findOne({ kidId: kid._id, itemId: kite, status: "active" }).lean();
  check("'Add as a surprise' (UI) adds a surprise", kiteRow?.surprise === true);
  // "Done" locks the PIN on the way out, so the child can't reopen the surprise page (review of 38e9eab).
  await page.goto(`${base}/kids/${kid._id}/surprise`);
  await hydrated(page);
  await page.locator('main:visible [data-testid="surprise-done"]').click();
  await page.waitForURL((u) => u.pathname.endsWith(`/kids/${kid._id}`), { timeout: 60_000 });
  await page.goto(`${base}/kids/${kid._id}/surprise`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  check("'Done' locks the PIN: the surprise page asks for it again", true);

  // 5. Paid (signed webhook): the surprise is fully funded = secured, ledger still exact.
  const piId = `pi_e2esur${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2esur${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const md = buildPaymentMetadata({ sos_purpose: "payup", sos_kid_id: String(kid._id), sos_family_id: String(fam._id), sos_wish_list_item_id: surpriseId });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: cents, amount_received: cents, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  const r = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  const after = await WishListItem.findById(surpriseId).lean();
  check("paid: the surprise is fully funded (guaranteed), not flagged for review", r.status === 200 && after?.status === "fully_funded" && after.fundedCentipoints === 2000 && !(await Payment.findOne({ stripePaymentIntentId: piId }).lean())?.needsReview);
  check("ledger consistent after the payment", (await ledgerOk()).length === 0, (await ledgerOk()).join("; "));

  // 6. Celebration on the child's page names no gift.
  await page.goto(`${base}/kids/${kid._id}`);
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 60_000 });
  const text = await dialog.innerText();
  check("celebration: 'Your surprise gift is all yours', no gift name", text.includes("Your surprise gift is all yours") && !text.includes(DRONE));
  check("child's page still never contains either surprise's name", !(await page.content()).includes(DRONE) && !(await page.content()).includes(KITE));

  // 7. Return page without a real session: a calm message, no crash.
  await page.goto(`${base}/kids/${kid._id}/surprise/return?session_id=cs_test_${tag}`);
  await page.locator("main:visible [role=alert], main:visible [role=status]").first().waitFor({ timeout: 60_000 });
  check("return page handles an unknown payment", (await page.locator("main:visible").innerText()).includes("couldn't find that payment"));

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await Promise.all([
    WishListItem.collection.deleteMany({ kidId: { $in: [kid._id, kid2._id] } }),
    Transaction.collection.deleteMany({ kidId: { $in: [kid._id, kid2._id] } }),
    Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } }),
    StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } }),
    Item.collection.deleteMany({ _id: { $in: [drone, kite, drone2].map((i) => new mongoose.Types.ObjectId(i)) } }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteMany({ _id: trusted({ $in: [kid._id, kid2._id] }) }),
    Family.deleteOne({ _id: fam._id }),
    User.deleteMany({ _id: trusted({ $in: [user._id] }) }),
    RateLimit.collection.deleteMany({ key: { $in: [`payup-start:${user._id}`] } }),
  ]);
  await mongoose.disconnect();
}
report();
