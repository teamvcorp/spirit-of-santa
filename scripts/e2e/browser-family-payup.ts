/**
 * E2E for Phase 6 slice 4a: the pay-up window (parent pays the missing amount of a gift) and the
 * Dec 25 close (unfinished gifts drop off, their points go to Spirit of Santa). Real browser (Edge)
 * for the parent pages; the payment itself goes through the dev server's SIGNED webhook.
 *
 *   family dev server on :3000 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-payup.ts http://localhost:3000
 *
 * Moves this season's dates (freeze = today, close = in 10 days, later close = today) and
 * RESTORES the Season document afterwards. *_dev database only; removes all its own data.
 */
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { chromium, type Page } from "playwright-core";
import { connectDb, Family, Item, Kid, Payment, RateLimit, Season, Store, StripeEvent, Transaction, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { startPayUp } from "@repo/families/payup";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { buildPaymentMetadata } from "@repo/payments/checkout";
import { lockFundedItems } from "@repo/wishlists/engine";
import { closeUnfunded } from "@repo/wishlists/payup";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-payup.ts <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const whsec = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!whsec.startsWith("whsec_")) throw new Error("STRIPE_WEBHOOK_SECRET missing");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `payup pass ${tag}`;
const PIN = "8154";
const DAY = 86_400_000;
const year = getSeasonYear();
const dayIso = (offsetDays: number) => isoDay(calendarDateIn(new Date(Date.now() + offsetDays * DAY)));

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const savedSeason = await Season.collection.findOne({ year });
const setDates = (freeze: string, close: string) => Season.collection.updateOne({ year }, { $set: { year, freezeDate: freeze, closeDate: close, forceFrozen: false } }, { upsert: true });

const mkFamily = async (n: string) => {
  const user = await User.create({ email: `e2e-pay-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const family = await Family.create({ ownerUserId: user._id, familyName: `Pay${n}${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: family._id } });
  return { user, family };
};
const A = await mkFamily("a");
const B = await mkFamily("b");
const registered = { status: "registered", registeredAt: new Date(), method: "card" };
// The kid already has 10 points on the Bike (escrowed): the ledger setup row explains it.
const kid = await Kid.create({ familyId: A.family._id, firstName: `Rio${tag}`, birthYear: 2016, displayName: "R.", availableCentipoints: 0, escrowedCentipoints: 1000, registration: registered });
const other = await Kid.create({ familyId: B.family._id, firstName: "Other", birthYear: 2016, displayName: "O.", registration: registered });
const storeId = oid();
await Store.collection.insertOne({ _id: storeId, name: `Pay Shop ${tag}`, slug: `e2e-pay-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
const mkItem = async (name: string, priceCents: number) => {
  const _id = oid();
  await Item.collection.insertOne({ _id, storeId, seasonYear: year, name: `${name} ${tag}`, priceCents, inventory: 5, status: "active", createdAt: new Date(), updatedAt: new Date() });
  return _id;
};
const bikeItem = await mkItem("Bike", 2500);
const bookItem = await mkItem("Book", 1000);
const mkWish = async (k: { _id: unknown; familyId: unknown }, itemId: unknown, cost: number, funded: number, ageDays: number) => {
  const _id = oid();
  await WishListItem.collection.insertOne({ _id, kidId: k._id, familyId: k.familyId, itemId, storeId, seasonYear: year, costCentipoints: cost, fundedCentipoints: funded, status: "active", createdAt: new Date(Date.now() - ageDays * DAY), updatedAt: new Date() });
  return String(_id);
};
const bike = await mkWish(kid, bikeItem, 2500, 1000, 20); // OLDER, 10 of 25
const book = await mkWish(kid, bookItem, 1000, 0, 5); // newer, 0 of 10
const otherWish = await mkWish(other, bookItem, 1000, 0, 5);
await Transaction.create({ kidId: kid._id, familyId: A.family._id, seasonYear: year, type: "escrow", amountCentipoints: 1000, wishListItemId: bike, note: "e2e setup" });
const piIds: string[] = [];
const evtIds: string[] = [];
const get = (id: string) => WishListItem.findById(id).lean();

/** A pay-up paid through the dev server's signed webhook. */
const paid = async (wishId: string, kidId: unknown, familyId: unknown, cents: number) => {
  const piId = `pi_e2epay${randomBytes(6).toString("hex")}`;
  const evtId = `evt_e2epay${randomBytes(6).toString("hex")}`;
  piIds.push(piId);
  evtIds.push(evtId);
  const md = buildPaymentMetadata({ sos_purpose: "payup", sos_kid_id: String(kidId), sos_family_id: String(familyId), sos_wish_list_item_id: wishId });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: evtId, object: "event", type: "payment_intent.succeeded", livemode: false, created: now, data: { object: { id: piId, object: "payment_intent", amount: cents, amount_received: cents, currency: "usd", status: "succeeded", livemode: false, metadata: md, created: now } } });
  const r = await fetch(`${base}/api/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret: whsec }) }, body });
  if (r.status !== 200) throw new Error(`webhook ${r.status}`);
  return piId;
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const parentA = { id: String(A.user._id), familyId: String(A.family._id) };

try {
  // 0. Window closed while the season is open (no freeze yet).
  await Season.collection.updateOne({ year }, { $unset: { freezeDate: 1, closeDate: 1 }, $set: { year, forceFrozen: false } }, { upsert: true });
  const early = await startPayUp(parentA, book, base, (p) => p);
  check("before the freeze: pay-up refused (window closed)", !early.ok && early.error === "windowClosed");

  // 1. Freeze today, close in 10 days → window open until close - 7 days.
  await setDates(dayIso(0), dayIso(10));
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/parent/payup`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin") && u.searchParams.get("next") === "/parent/payup", { timeout: 60_000 });
  check("pay-up page needs the parent PIN (and comes back after)", true);
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent/payup"), { timeout: 60_000 });
  await page.locator('main:visible [data-testid="payup-list"]').waitFor({ timeout: 60_000 });
  const list = await page.locator('main:visible [data-testid="payup-list"]').innerText();
  check("lists both unfinished gifts with the server's price (Bike: 15 Christmas Magic = $22.50)", list.includes(`Bike ${tag}`) && list.includes(`Book ${tag}`) && list.includes("15 more Christmas Magic: $22.50") && list.includes("$15.00"));
  check("another family's gift is not listed", !list.includes("Other"));
  await page.goto(`${base}/parent`);
  await page.locator('main:visible [data-testid="payup-alert"]').waitFor({ timeout: 60_000 });
  check("parent dashboard alerts: 2 gifts aren't fully funded", (await page.locator('main:visible [data-testid="payup-alert"]').innerText()).includes("2 gifts aren't fully funded"));
  await page.goto(`${base}/parent/payup`);
  await hydrated(page);
  await page.locator(`main:visible li[data-wish="${bike}"] button[type=submit]`).click();
  await page.locator('[data-testid="stripe-checkout"] iframe').first().waitFor({ timeout: 60_000 });
  check("'Finish for $22.50' opens Stripe's embedded form for that amount",
    (await page.locator(`main:visible li[data-wish="${bike}"]`).innerText()).includes("To pay: $22.50"));

  // 2. Paid for the NEWER Book ($15 = 10 points): the Book is filled first, not the older Bike.
  const pi = await paid(book, kid._id, A.family._id, 1500);
  const [wBook, wBike, k1, tx] = await Promise.all([get(book), get(bike), Kid.findById(kid._id).lean(), Transaction.findOne({ stripePaymentIntentId: pi }).lean()]);
  check("pay-up fills the gift it paid for (Book fully funded), not the oldest", wBook?.status === "fully_funded" && wBook.fundedCentipoints === 1000 && wBike?.fundedCentipoints === 1000);
  check("ledger 'earn_payup' with the money; kid escrow 20 points", tx?.type === "earn_payup" && tx.cents === 1500 && k1?.escrowedCentipoints === 2000 && k1.availableCentipoints === 0);
  await lockFundedItems();
  check("after the freeze date, the paid-up gift locks (ready to ship)", (await get(book))?.status === "locked");

  // 3. Refusals: already funded / other family's gift / forged webhook for someone else's gift.
  const s1 = await startPayUp(parentA, book, base, (p) => p);
  const s2 = await startPayUp(parentA, otherWish, base, (p) => p);
  check("server: already-funded gift → notNeeded; other family's gift → notFound", !s1.ok && s1.error === "notNeeded" && !s2.ok && s2.error === "notFound");
  const piX = await paid(otherWish, kid._id, A.family._id, 1500);
  const px = await Payment.findOne({ stripePaymentIntentId: piX }).lean();
  check("webhook: pay-up naming another kid's gift → flagged for review, no points", px?.fulfilment === "review" && (await Kid.findById(kid._id).lean())?.escrowedCentipoints === 2000);

  // 3b. Paying the (now locked) Book again: credited as points but FLAGGED for an admin.
  const piDup = await paid(book, kid._id, A.family._id, 1500);
  const pd = await Payment.findOne({ stripePaymentIntentId: piDup }).lean();
  check("duplicate pay-up for a finished gift: credited AND flagged for review", pd?.fulfilment === "credited" && pd.needsReview === true && /already locked/.test(pd.reviewReason ?? ""));
  // The 10 duplicate points flowed to the next unfinished gift (the Bike): reflect that in later checks.
  const bikeAfterDup = (await get(bike))?.fundedCentipoints ?? 0;

  // 4. Window closes 7 days before the close.
  await setDates(dayIso(0), dayIso(6));
  const late = await startPayUp(parentA, bike, base, (p) => p);
  check("within 7 days of the close: pay-up refused", !late.ok && late.error === "windowClosed");

  // 5. Close day: the unfinished Bike drops off; ALL points on it (10 + the 10 from the duplicate pay-up)
  // go to Spirit of Santa. The locked Book stays. A gift whose kid escrow is out of sync is PARKED.
  const bad = await mkWish(other, bookItem, 1000, 500, 3); // claims 5 points the other kid never had
  await setDates(dayIso(-1), dayIso(0));
  const c1 = await closeUnfunded();
  const [cBike, cBook, k2, forfeit] = await Promise.all([get(bike), get(book), Kid.findById(kid._id).lean(), Transaction.findOne({ wishListItemId: bike, type: 'forfeit' }).lean()]);
  check('close: unfinished gift → unfunded, all its points forfeited (ledger forfeit)', bikeAfterDup === 2000 && cBike?.status === 'unfunded' && cBike.forfeitedCentipoints === 2000 && forfeit?.amountCentipoints === 2000);
  check('close: kid escrow down by exactly the forfeit; the funded gift is untouched', k2?.escrowedCentipoints === 1000 && cBook?.status === 'locked');
  check('close: an out-of-sync gift fails ONCE and is parked for a human', c1.failed === 1 && !!(await get(bad))?.closeNeedsAttentionAt && (await get(bad))?.status === 'active');
  const c2 = await closeUnfunded();
  check('close re-run: nothing forfeited twice; the parked gift no longer fails the job', (await Transaction.countDocuments({ wishListItemId: bike, type: 'forfeit' })) === 1 && (await Kid.findById(kid._id).lean())?.escrowedCentipoints === 1000 && c2.failed === 0 && c2.needsAttention >= 1);

  // 6. The ledger still explains the kid's balances exactly.
  const rows = await Transaction.find({ kidId: kid._id }).lean();
  const sum = (t: string) => rows.filter((r) => r.type === t).reduce((s, r) => s + r.amountCentipoints, 0);
  const k3 = await Kid.findById(kid._id).lean();
  check("ledger adds up: escrow = escrowed − released − forfeited", k3?.escrowedCentipoints === sum("escrow") - sum("release") - sum("forfeit") && k3.availableCentipoints === 1000 /* earned before the test (its escrow row is the setup row) */ + sum("earn_payup") - sum("escrow") + sum("release"));

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await Season.collection.deleteOne({ year });
  if (savedSeason) await Season.collection.insertOne(savedSeason);
  const kidIds = [kid._id, other._id];
  await Promise.all([
    WishListItem.collection.deleteMany({ kidId: { $in: kidIds } }),
    Transaction.collection.deleteMany({ kidId: { $in: kidIds } }),
    Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } }),
    StripeEvent.collection.deleteMany({ eventId: { $in: evtIds } }),
    Item.collection.deleteMany({ _id: { $in: [bikeItem, bookItem] } }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteMany({ _id: trusted({ $in: kidIds }) }),
    Family.deleteMany({ _id: trusted({ $in: [A.family._id, B.family._id] }) }),
    User.deleteMany({ _id: trusted({ $in: [A.user._id, B.user._id] }) }),
    RateLimit.collection.deleteMany({ key: { $in: [`payup-start:${A.user._id}`] } }),
  ]);
  await mongoose.disconnect();
}
report();
