/**
 * E2E for Phase 6 slice 3a: lock at 30 days / at the freeze, the daily store digest, and the store
 * app's Orders page ("Mark shipped") in a real browser (Edge).
 *
 *   store dev server on :3001 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/store/.env.local scripts/e2e/browser-store-orders.ts http://localhost:3001
 *
 * Needs the season OPEN today. *_dev database only. Creates and removes all its own data, and
 * restores the Season document and the platform shipping address.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Item, PlatformSettings, Season, Store, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { lockFundedItems } from "@repo/wishlists/engine";
import { markShipped, orderRef as ref, sendStoreDigests } from "@repo/wishlists/fulfilment";
import { calendarDateIn, isoDay } from "@repo/lib/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-store-orders.ts <storeUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mail = (n: string) => `e2e-ord-${n}-${tag}@spiritofsanta.test`;
const PW = `orders pass ${tag}`;
const DAY = 86_400_000;
const ADDRESS = `Spirit of Santa ${tag}\n100 North Pole Way\nAustin, TX 78701`;
const KID_NAME = `Zebulon${tag}`; // must NEVER appear on store pages or emails

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const year = getSeasonYear();
const savedSeason = await Season.collection.findOne({ year });
const savedSettings = await PlatformSettings.collection.findOne({ key: "platform" });
const hash = await hashSecret(PW);

async function mkStore(n: string) {
  const owner = await User.create({ email: mail(n), passwordHash: hash, role: "store_owner", status: "active" });
  const s = await Store.create({ name: `Ord ${n} ${tag}`, slug: `ord-${n}-${tag}`, category: "toys", status: "approved", ownerUserId: owner._id, discountBps: 2000, contact: { email: mail(n) } });
  await User.updateOne({ _id: owner._id }, { $set: { storeId: s._id } });
  return { owner, id: s._id };
}
const A = await mkStore("a");
const B = await mkStore("b");
const rep = await User.create({ email: mail("rep"), passwordHash: hash, role: "store_rep", status: "active", storeId: A.id, name: "Rep" });
await Store.updateOne({ _id: A.id }, { $push: { repUserIds: rep._id } });
const bike = await Item.create({ storeId: A.id, seasonYear: year, name: `Bike ${tag}`, priceCents: 2500, inventory: 3, status: "active" });
const kite = await Item.create({ storeId: A.id, seasonYear: year, name: `Kite ${tag}`, priceCents: 500, inventory: 0, status: "active" });
const drum = await Item.create({ storeId: B.id, seasonYear: year, name: `Drum ${tag}`, priceCents: 800, inventory: 2, status: "active" });
const kidId = oid();
const familyId = oid();
const wish = async (it: { _id: unknown; storeId: unknown }, status: string, fundedDaysAgo: number, extra: Record<string, unknown> = {}) => {
  const _id = oid();
  // Raw insert: the store side never needs a real kid, and the kid's name is planted in NO store-visible field.
  await WishListItem.collection.insertOne({ _id, kidId, familyId, itemId: it._id, storeId: it.storeId, seasonYear: year, costCentipoints: 100, fundedCentipoints: 100, status, fullyFundedAt: new Date(Date.now() - fundedDaysAgo * DAY), createdAt: new Date(), updatedAt: new Date(), ...extra });
  return String(_id);
};
const old = await wish(bike, "fully_funded", 31); // → locks by age
const fresh = await wish(bike, "fully_funded", 2); // stays "set aside" while open
const freezeOnly = await wish(bike, "fully_funded", 1); // locks only at the freeze (test 2)
const outOfStock = await wish(kite, "fully_funded", 40, { needsSubstitute: true });
const otherStore = await wish(drum, "fully_funded", 35);
const allWish = [old, fresh, freezeOnly, outOfStock, otherStore];
const status = async (id: string) => (await WishListItem.findById(id).lean())?.status;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });

try {
  await PlatformSettings.collection.updateOne({ key: "platform" }, { $unset: { shippingAddress: 1 } });

  // 1. Lock by age while the season is open: only the 30+ days ones (+ the out-of-stock one).
  await lockFundedItems();
  check("open season: 30+ days fully funded → locked; newer ones stay fully funded",
    (await status(old)) === "locked" && (await status(fresh)) === "fully_funded" && (await status(freezeOnly)) === "fully_funded" && (await status(otherStore)) === "locked");

  // 2. No shipping address yet → digest waits (and marks nothing).
  const d0 = await sendStoreDigests();
  check("digest waits until the admin saves the shipping address", d0.skipped === "noAddress" && d0.emails === 0);
  await PlatformSettings.collection.updateOne({ key: "platform" }, { $set: { shippingAddress: ADDRESS } }, { upsert: true });

  // 3. Digest: emails owner + rep of store A (and owner of B); lists refs + address, never the child.
  const printed: string[] = [];
  const orig = { log: console.log, info: console.info };
  console.log = console.info = (...a: unknown[]) => printed.push(a.map(String).join(" "));
  let d1;
  try {
    d1 = await sendStoreDigests();
  } finally {
    Object.assign(console, orig);
  }
  const out = printed.join("\n");
  // Other dev data may be pending too: check OUR stores' part.
  check("digest emailed store A's owner + rep and store B's owner", out.includes(mail("a")) && out.includes(mail("rep")) && out.includes(mail("b")) && (d1?.emails ?? 0) >= 3);
  check("email lists set-aside + ready gifts with refs and the address", out.includes(`1 × Bike ${tag} (${ref(old)})`) && out.includes(ref(fresh)) && out.includes("North Pole Way"));
  check("out-of-stock gift NOT in the email (admin arranges a substitute first)", !out.includes(ref(outOfStock)));
  check("emails never mention the child", !out.includes(KID_NAME) && !out.includes(String(kidId)));
  const wOld = await WishListItem.findById(old).lean();
  const wFresh = await WishListItem.findById(fresh).lean();
  check("told-at times recorded (ready + set aside)", !!wOld?.readyNotifiedAt && !!wOld.setAsideNotifiedAt && !!wFresh?.setAsideNotifiedAt && !wFresh.readyNotifiedAt);
  const stamps = async () => JSON.stringify(await WishListItem.find({ _id: trusted({ $in: allWish }) }).select("setAsideNotifiedAt readyNotifiedAt").sort({ _id: 1 }).lean());
  const before = await stamps();
  const d2 = await sendStoreDigests();
  check("second run: nothing new for our stores (no gift re-told)", (await stamps()) === before && d2.failed === 0);

  // 4. Store app: owner signs in → overview alert → Orders page.
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.owner.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/dashboard`);
  await page.locator('main:visible [data-testid="orders-alert"]').waitFor({ timeout: 60_000 });
  check("overview alert: 1 ready to ship, 2 to set aside", /1 gift is ready to ship\. 2 gifts to set aside\./.test(await page.locator('main:visible [data-testid="orders-alert"]').innerText()));
  await page.locator("main:visible a", { hasText: "Orders" }).first().click();
  await page.waitForURL((u) => u.pathname.endsWith("/dashboard/orders"), { timeout: 60_000 });
  await page.locator('main:visible [data-testid="ready"]').waitFor({ timeout: 60_000 });
  const ready = await page.locator('main:visible [data-testid="ready"]').innerText();
  const aside = await page.locator('main:visible [data-testid="set-aside"]').innerText();
  const outText = await page.locator('main:visible [data-testid="out-of-stock"]').innerText();
  check("Ready to ship: the locked Bike with its ref + the ship-to address", ready.includes(ref(old)) && ready.includes("100 North Pole Way") && !ready.includes(ref(fresh)));
  check("Set aside: the 2 newer Bikes; Out of stock: the Kite", aside.includes(ref(fresh)) && aside.includes(ref(freezeOnly)) && outText.includes(ref(outOfStock)));
  const whole = await page.locator("main:visible").innerText();
  check("Orders page: no other store's gifts, nothing about the child", !whole.includes(ref(otherStore)) && !whole.includes(`Drum ${tag}`) && !whole.includes(KID_NAME));

  // 5. Mark shipped with a tracking note.
  await hydrated(page);
  await page.fill(`main:visible input[aria-label="Tracking for ${ref(old)}"]`, "UPS 1Z999TEST");
  await page.locator('main:visible [data-testid="ready"] button[type=submit]').first().click();
  await page.locator('main:visible [data-testid="shipped"]', { hasText: ref(old) }).waitFor({ timeout: 60_000 });
  const shippedText = await page.locator('main:visible [data-testid="shipped"]').innerText();
  const wShip = await WishListItem.findById(old).lean();
  check("Mark shipped: moves to Shipped with the tracking note; DB status 'shipped' by the owner",
    shippedText.includes("UPS 1Z999TEST") && wShip?.status === "shipped" && String(wShip.shippedByUserId) === String(A.owner._id) && wShip.trackingNote === "UPS 1Z999TEST");
  check("shipping is audited", (await AuditLog.countDocuments({ action: "wish.ship", targetId: old })) === 1);

  // 6. Server refuses: set-aside gift (not locked), out-of-stock gift, already shipped, other store's gift.
  const actorA = { id: String(A.owner._id), role: "store_owner", storeId: String(A.id) };
  const repA = { id: String(rep._id), role: "store_rep", storeId: String(A.id) };
  const [r1, r2, r3, r4] = [await markShipped(actorA, fresh, ""), await markShipped(actorA, outOfStock, ""), await markShipped(repA, old, ""), await markShipped(actorA, otherStore, "")];
  check("server: set-aside / out-of-stock / already-shipped → notReady; other store's → notFound",
    !r1.ok && r1.error === "notReady" && !r2.ok && r2.error === "notReady" && !r3.ok && r3.error === "notReady" && !r4.ok && r4.error === "notFound");

  // 7. The admin's force-freeze switch must NOT lock anything for good (it can be switched off again).
  await Season.collection.updateOne({ year }, { $set: { forceFrozen: true } }, { upsert: true });
  await lockFundedItems();
  check("force-freeze switch (reversible) locks nothing early", (await status(fresh)) === "fully_funded" && (await status(freezeOnly)) === "fully_funded");
  // 8. The freeze DATE reached (here: today) → every fully funded gift of this season locks at once.
  await Season.collection.updateOne({ year }, { $set: { forceFrozen: false, freezeDate: isoDay(calendarDateIn(new Date())) } });
  await lockFundedItems();
  check("on the freeze date: all fully funded gifts lock (even 1-day-old ones)", (await status(fresh)) === "locked" && (await status(freezeOnly)) === "locked");

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await Season.collection.deleteOne({ year });
  if (savedSeason) await Season.collection.insertOne(savedSeason);
  if (savedSettings) await PlatformSettings.collection.replaceOne({ key: "platform" }, savedSettings);
  else await PlatformSettings.collection.deleteOne({ key: "platform" });
  await Promise.all([
    WishListItem.collection.deleteMany({ _id: { $in: allWish.map((id) => new mongoose.Types.ObjectId(id)) } }),
    AuditLog.collection.deleteMany({ targetId: { $in: allWish.map((id) => new mongoose.Types.ObjectId(id)) } }),
    Item.deleteMany({ _id: trusted({ $in: [bike._id, kite._id, drum._id] }) }),
    Store.deleteMany({ _id: trusted({ $in: [A.id, B.id] }) }),
    User.deleteMany({ _id: trusted({ $in: [A.owner._id, B.owner._id, rep._id] }) }),
  ]);
  await mongoose.disconnect();
}
report();
