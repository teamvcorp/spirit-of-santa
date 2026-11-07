/**
 * E2E for store orders under the year-round season (slices 3+4, owner 2026-11-07):
 *  - every fully funded gift LOCKS at the next daily job, whatever its age (magic spent);
 *  - locked gifts are HELD by the store until the December ship window (the freeze date);
 *  - LAST season's locked gifts may always ship (a gift locked Dec 26 is never held another year);
 *  - the digest tells a held gift once as "held for December" (setAsideNotifiedAt ONLY) and again,
 *    exactly once, as "ready to ship" when the window opens;
 *  - markShipped refuses a held gift with "notYet" (server-side, not just hidden buttons).
 * Real browser (Edge) for the store Orders page and "Mark shipped".
 *
 *   store dev server on :3001 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/store/.env.local scripts/e2e/browser-store-orders.ts http://localhost:3001
 *
 * Needs the season OPEN today, before its freeze date. *_dev database only. Creates and removes all its own
 * data, and restores the Season document and the platform shipping address.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Item, Kid, PlatformSettings, Season, Store, Transaction, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { getSeasonState } from "@repo/stores/season";
import { lockFundedItems } from "@repo/wishlists/engine";
import { markShipped, orderCounts, orderRef as ref, sendStoreDigests } from "@repo/wishlists/fulfilment";
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
const start = await getSeasonState();
if (start.phase !== "open" || start.shipping.open) throw new Error(`refusing: needs an open season before its ship window (phase ${start.phase})`);
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
const familyId = oid();
// A REAL kid: locking SPENDS the gift's magic from the kid's escrow, so a made-up kid would (rightly) be parked.
// Escrow = the 4 fully funded gifts below × 100 (last season's gift is already locked = already spent).
const kidDoc = await Kid.create({ familyId, firstName: KID_NAME, birthYear: 2016, displayName: "Z.", escrowedCentipoints: 400, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const kidId = kidDoc._id;
const escrow = async () => (await Kid.findById(kidId).lean())?.escrowedCentipoints;
const wish = async (it: { _id: unknown; storeId: unknown }, status: string, fundedDaysAgo: number, extra: Record<string, unknown> = {}) => {
  const _id = oid();
  // Raw insert: the kid's name is planted in NO store-visible field.
  await WishListItem.collection.insertOne({ _id, kidId, familyId, itemId: it._id, storeId: it.storeId, seasonYear: year, costCentipoints: 100, fundedCentipoints: 100, status, fullyFundedAt: new Date(Date.now() - fundedDaysAgo * DAY), createdAt: new Date(), updatedAt: new Date(), ...extra });
  return String(_id);
};
const heldOld = await wish(bike, "fully_funded", 31); // funded a month ago: still HELD (no 30-day rule any more)
const held = await wish(bike, "fully_funded", 0); // funded today: locks at the next job, held too
// Locked on Dec 26 of LAST season and never shipped: must be shippable now, not held until next December.
const lastSeason = await wish(bike, "locked", 320, { seasonYear: year - 1, lockedAt: new Date(Date.now() - 315 * DAY) });
const outOfStock = await wish(kite, "fully_funded", 40, { needsSubstitute: true });
const otherStore = await wish(drum, "fully_funded", 35);
const allWish = [heldOld, held, lastSeason, outOfStock, otherStore];
const status = async (id: string) => (await WishListItem.findById(id).lean())?.status;
const stamps = async () => JSON.stringify(await WishListItem.find({ _id: trusted({ $in: allWish }) }).select("setAsideNotifiedAt readyNotifiedAt").sort({ _id: 1 }).lean());

/** Run the digest, capturing the dev mailer's printed emails. */
async function digest() {
  const printed: string[] = [];
  const orig = { log: console.log, info: console.info };
  console.log = console.info = (...a: unknown[]) => printed.push(a.map(String).join(" "));
  try {
    const r = await sendStoreDigests();
    return { r, out: printed.join("\n") };
  } finally {
    Object.assign(console, orig);
  }
}
/** The text of one email section (from its heading to the next blank-line heading). */
const section = (out: string, heading: string) => {
  const i = out.indexOf(heading);
  if (i < 0) return "";
  const rest = out.slice(i);
  const end = rest.indexOf("\n\n", heading.length);
  return end < 0 ? rest : rest.slice(0, end);
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

try {
  await PlatformSettings.collection.updateOne({ key: "platform" }, { $unset: { shippingAddress: 1 } });

  // 1. Lock at full funding: EVERY fully funded gift locks at the next run, whatever its age.
  await lockFundedItems();
  check("open season: every fully funded gift locks at the next job (1 month AND today)",
    (await status(heldOld)) === "locked" && (await status(held)) === "locked" && (await status(outOfStock)) === "locked" && (await status(otherStore)) === "locked");
  check("lock spends all their magic: escrow 400 → 0", (await escrow()) === 0, String(await escrow()));

  // 2. No shipping address yet → digest waits (and marks nothing).
  const d0 = await sendStoreDigests();
  check("digest waits until the admin saves the shipping address", d0.skipped === "noAddress" && d0.emails === 0);
  await PlatformSettings.collection.updateOne({ key: "platform" }, { $set: { shippingAddress: ADDRESS } }, { upsert: true });

  // 3. Digest outside the window: this season's gifts are "held", last season's is "ready" (as soon as possible).
  const { r: d1, out } = await digest();
  const heldPart = section(out, "HELD FOR DECEMBER");
  const readyPart = section(out, "READY TO SHIP");
  check("digest emailed store A's owner + rep and store B's owner", out.includes(mail("a")) && out.includes(mail("rep")) && out.includes(mail("b")) && d1.emails >= 3);
  check("this season's locked gifts are listed as HELD FOR DECEMBER (not ready)", heldPart.includes(ref(heldOld)) && heldPart.includes(ref(held)) && !readyPart.includes(ref(held)) && !readyPart.includes(ref(heldOld)));
  check("last season's locked gift is READY TO SHIP, 'as soon as possible'", readyPart.includes(ref(lastSeason)) && readyPart.includes("as soon as possible"));
  check("held section names the ship-from date (December 1)", /December 1\b/.test(heldPart), heldPart.slice(0, 160));
  check("out-of-stock gift NOT in the email; address included", !out.includes(ref(outOfStock)) && out.includes("North Pole Way"));
  check("emails never mention the child", !out.includes(KID_NAME) && !out.includes(String(kidId)));
  const wHeld = await WishListItem.findById(held).lean();
  const wLast = await WishListItem.findById(lastSeason).lean();
  check("held gift: ONLY setAsideNotifiedAt (so December's 'ship now' still goes out)", !!wHeld?.setAsideNotifiedAt && !wHeld.readyNotifiedAt);
  check("last season's gift: readyNotifiedAt set", !!wLast?.readyNotifiedAt);
  const before = await stamps();
  await digest();
  check("second run: nothing re-told for our stores", (await stamps()) === before);

  // 4. Store app: owner signs in → overview alert → Orders page.
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.owner.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/dashboard`);
  await page.locator('main:visible [data-testid="orders-alert"]').waitFor({ timeout: 60_000 });
  const alert = await page.locator('main:visible [data-testid="orders-alert"]').innerText();
  check("overview alert: 1 ready to ship, 2 held for December", /1 gift is ready to ship\. 2 gifts held for December\./.test(alert), alert);
  await page.locator("main:visible a", { hasText: "Orders" }).first().click();
  await page.waitForURL((u) => u.pathname.endsWith("/dashboard/orders"), { timeout: 60_000 });
  await page.locator('main:visible [data-testid="ready"]').waitFor({ timeout: 60_000 });
  const ready = await page.locator('main:visible [data-testid="ready"]').innerText();
  const aside = await page.locator('main:visible [data-testid="set-aside"]').innerText();
  const outText = await page.locator('main:visible [data-testid="out-of-stock"]').innerText();
  check("Ready to ship: only last season's gift, 'as soon as possible', with the ship-to address",
    ready.includes(ref(lastSeason)) && !ready.includes(ref(held)) && ready.includes("as soon as possible") && ready.includes("100 North Pole Way"), ready.slice(0, 200));
  check("Held for December: both this-season gifts and the date they become shippable",
    /Held for December \(2\)/.test(aside) && aside.includes(ref(heldOld)) && aside.includes(ref(held)) && /December 1\b/.test(aside), aside.slice(0, 200));
  check("Out of stock: the Kite", outText.includes(ref(outOfStock)));
  const whole = await page.locator("main:visible").innerText();
  check("Orders page: no other store's gifts, nothing about the child", !whole.includes(ref(otherStore)) && !whole.includes(`Drum ${tag}`) && !whole.includes(KID_NAME));
  check("held gifts have no 'Mark shipped' button", (await page.locator('main:visible [data-testid="set-aside"] button').count()) === 0);

  // 5. Mark last season's gift shipped (a gift locked Dec 26 still ships in the new year).
  await hydrated(page);
  await page.fill(`main:visible input[aria-label="Tracking for ${ref(lastSeason)}"]`, "UPS 1Z999TEST");
  await page.locator('main:visible [data-testid="ready"] button[type=submit]').first().click();
  await page.locator('main:visible [data-testid="shipped"]', { hasText: ref(lastSeason) }).waitFor({ timeout: 60_000 });
  const shippedText = await page.locator('main:visible [data-testid="shipped"]').innerText();
  const wShip = await WishListItem.findById(lastSeason).lean();
  check("Mark shipped: last season's gift moves to Shipped with the tracking note, by the owner",
    shippedText.includes("UPS 1Z999TEST") && wShip?.status === "shipped" && String(wShip.shippedByUserId) === String(A.owner._id) && wShip.trackingNote === "UPS 1Z999TEST");
  check("shipping is audited", (await AuditLog.countDocuments({ action: "wish.ship", targetId: lastSeason })) === 1);

  // 6. Server refuses: held gift (crafted request) → notYet; out-of-stock / already shipped → notReady; other store → notFound.
  const actorA = { id: String(A.owner._id), role: "store_owner", storeId: String(A.id) };
  const repA = { id: String(rep._id), role: "store_rep", storeId: String(A.id) };
  const [r1, r2, r3, r4] = [await markShipped(actorA, held, ""), await markShipped(actorA, outOfStock, ""), await markShipped(repA, lastSeason, ""), await markShipped(actorA, otherStore, "")];
  check("server: held → notYet; out-of-stock / already shipped → notReady; other store's → notFound",
    !r1.ok && r1.error === "notYet" && !r2.ok && r2.error === "notReady" && !r3.ok && r3.error === "notReady" && !r4.ok && r4.error === "notFound", JSON.stringify([r1, r2, r3, r4]));
  check("…and the held gift is still locked", (await status(held)) === "locked");

  // 7. The admin's emergency force-freeze does NOT open the ship window (only the freeze DATE does).
  await Season.collection.updateOne({ year }, { $set: { forceFrozen: true } }, { upsert: true });
  const fz = await markShipped(actorA, held, "");
  check("force-freeze: held gifts still can't ship", !fz.ok && fz.error === "notYet");

  // 8. The freeze DATE reached (here: today) → the window opens: "ready", one "ship now" email, shipping allowed.
  await Season.collection.updateOne({ year }, { $set: { forceFrozen: false, freezeDate: isoDay(calendarDateIn(new Date())) } });
  const counts = await orderCounts(A.id);
  check("window open: overview counts both held gifts as ready", counts.ready === 2 && counts.setAside === 0, JSON.stringify(counts));
  const { out: out2 } = await digest();
  const ready2 = section(out2, "READY TO SHIP");
  check("window opens: the held gifts are announced once as READY TO SHIP 'by December 10'",
    ready2.includes(ref(held)) && ready2.includes(ref(heldOld)) && /by December 10\b/.test(ready2), ready2.slice(0, 200));
  check("…and marked told (readyNotifiedAt)", !!(await WishListItem.findById(held).lean())?.readyNotifiedAt);
  const before2 = await stamps();
  const { out: out3 } = await digest();
  check("second run in the window: no repeat for our gifts", (await stamps()) === before2 && !out3.includes(ref(held)));
  const ok = await markShipped(repA, held, "");
  check("in the window the rep can ship the held gift", ok.ok && (await status(held)) === "shipped");

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
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
    Kid.deleteOne({ _id: kidId }),
    Transaction.collection.deleteMany({ kidId }),
  ]);
  await mongoose.disconnect();
}
process.exit(report());
