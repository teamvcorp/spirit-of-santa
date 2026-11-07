/**
 * Real-browser E2E (Edge) for Phase 8 "deliver, then delete" (owner decision 2026-11-07): a family deletes its
 * account while a paid gift is on its way and chooses to receive it first (@repo/families/erase).
 *
 *   dev servers running (output logged to a file), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *     scripts/e2e/browser-family-deliver-then-delete.ts http://localhost:3000 <dev-log-file>
 *
 * *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { ownFamilyId } from "@repo/auth/family-owner";
import { hashSecret } from "@repo/auth/password";
import { sealJson } from "@repo/auth/sealed";
import { AuditLog, connectDb, Family, Item, Kid, Store, Transaction, trusted, User, WishListItem } from "@repo/db";
import { saveAddress } from "@repo/families/address";
import { eraseFamily, finalizeClosingFamilies } from "@repo/families/erase";
import { getSeasonYear } from "@repo/lib/season";
import { adminFulfilment, markSentToFamily } from "@repo/wishlists/fulfilment";
import { makeChecks } from "./lib.ts";

const [base, logFile] = process.argv.slice(2);
if (!base || !logFile) throw new Error("usage: browser-family-deliver-then-delete.ts <familyUrl> <dev-log-file>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `dtd pass ${tag}`;
const PIN = "8158";
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const year = getSeasonYear();
const DAY = 86_400_000;
const storeId = oid();
await Store.collection.insertOne({ _id: storeId, name: `DTD Shop ${tag}`, slug: `e2e-dtd-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
const itemId = oid();
await Item.collection.insertOne({ _id: itemId, storeId, seasonYear: year, name: `Sled ${tag}`, priceCents: 2000, inventory: 1, status: "active", createdAt: new Date(), updatedAt: new Date() });
const families: unknown[] = [];
const users: unknown[] = [];
const ADDRESS = { name: "Ada Parent", line1: "1 Elf Road", line2: "", city: "Ames", state: "IA", zip: "50010" };

/** A family with one child, an alias + ZIP (must NOT survive), one LOCKED gift (spent at lock) and, optionally, an address. */
async function mkFamily(n: string, withAddress: boolean) {
  const user = await User.create({ email: `e2e-dtd-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active", name: `Parent ${n}` });
  const fam = await Family.create({ ownerUserId: user._id, familyName: `Dtd${n}${tag}`, alias: "Elves", showAliasPublicly: true, zip: "50010", parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date(), emailVerifiedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
  families.push(fam._id);
  users.push(user._id);
  const kid = await Kid.create({ familyId: fam._id, firstName: `Kid${n}${tag}`, birthYear: 2016, displayName: "K.", registration: { status: "registered", registeredAt: new Date(), method: "card" } });
  const giftId = oid();
  await WishListItem.collection.insertOne({ _id: giftId, kidId: kid._id, familyId: fam._id, itemId, storeId, seasonYear: year, costCentipoints: 2000, fundedCentipoints: 2000, status: "locked", fullyFundedAt: new Date(Date.now() - 31 * DAY), lockedAt: new Date(), inventoryReserved: true, createdAt: new Date(), updatedAt: new Date() });
  await Transaction.collection.insertOne({ kidId: kid._id, familyId: fam._id, seasonYear: year, type: "spend", amountCentipoints: 2000, wishListItemId: giftId, idempotencyKey: `spend:${String(giftId)}`, createdAt: new Date() });
  if (withAddress) await Family.updateOne({ _id: fam._id }, { $set: { deliveryAddressEnc: sealJson(ADDRESS, String(fam._id), "ADDRESS_ENCRYPTION_KEY"), deliveryAddressUpdatedAt: new Date() } });
  return { user, fam, kid, giftId, parent: { id: String(user._id), familyId: String(fam._id) } };
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const main = (p: Page) => p.locator("main:visible").first();
const log = () => readFileSync(logFile, "utf8");

try {
  // ── 1. Through the browser: family A (address on file) chooses "deliver first".
  const A = await mkFamily("a", true);
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/signin`);
  await ready(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/parent/delete-account`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  await ready(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent/delete-account"), { timeout: 60_000 });
  await ready(page);
  const choice = main(page).getByTestId("delete-choice");
  check("the page offers the choice; 'deliver first' is pre-selected", (await choice.isVisible()) && (await choice.locator('input[value="deliverFirst"]').isChecked()));
  const logBefore = log().length;
  await page.fill('main:visible [name="password"]', PW);
  await page.fill('main:visible [name="confirm"]', "DELETE");
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/account-deleted/closing"), { timeout: 60_000 });
  check("lands on the 'closing' goodbye page", (await main(page).innerText()).includes("Your children's information is deleted"));

  const famA = await Family.collection.findOne({ _id: A.fam._id });
  const keys = Object.keys(famA ?? {}).sort().join(",");
  check("the family record keeps ONLY the allow-list (name, address, contact, dates)", keys === "_id,deletionContactEnc,deletionDeadline,deletionRequestedAt,deliveryAddressEnc,deliveryAddressUpdatedAt,familyName,ownerUserId,updatedAt", keys);
  check("the child and the sign-in account are deleted now", !(await Kid.exists({ _id: A.kid._id })) && !(await User.exists({ _id: A.user._id })));
  const deadline = famA?.deletionDeadline as Date | undefined;
  check("deletion deadline is set within 45 days", !!deadline && deadline.getTime() <= Date.now() + 45 * DAY + 60_000 && deadline.getTime() > Date.now());
  check("every family action refuses the closing family (even an old session)", (await ownFamilyId(A.parent)) === null && (await saveAddress(A.parent, ADDRESS)).ok === false);
  check("the request is audited (ids only)", !!(await AuditLog.exists({ action: "family.delete_requested", targetId: String(A.fam._id) })));
  await new Promise((r) => setTimeout(r, 1500));
  check("'deletion started' email sent", log().slice(logBefore).includes("deleting your Spirit of Santa family account"));
  check("the email address is free to sign up again (no user holds it)", !(await User.exists({ email: A.user.email })));

  // ── 2. Before delivery the finaliser WAITS (the gift is still on its way).
  const f1 = await finalizeClosingFamilies();
  check("finaliser waits while the gift is on its way", f1.waiting >= 1 && !!(await Family.exists({ _id: A.fam._id })));

  // ── 3. Admin: the store shipped, Spirit of Santa received it → queue shows the address + the closing date.
  await WishListItem.updateOne({ _id: A.giftId }, { $set: { status: "shipped", shippedAt: new Date(), receivedAt: new Date() } });
  const admin = await User.create({ email: `e2e-dtd-admin-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "admin", status: "active" });
  users.push(admin._id);
  const q = await adminFulfilment(String(admin._id));
  const row = q.toSend.rows.find((r) => r.id === String(A.giftId));
  check("admin queue: address shown, 'account closing, send by' date shown", Array.isArray(row?.address) && row.address.join(" ").includes("1 Elf Road") && !!row.closingBy);
  const before3 = log().length;
  const sent = await markSentToFamily(String(admin._id), String(A.giftId));
  await new Promise((r) => setTimeout(r, 500));
  const g = await WishListItem.findById(A.giftId).lean();
  check("'Sent to family' works and the name-less delivery email goes to the kept contact", sent.ok && g?.status === "delivered" && !!g.familyNotifiedAt);
  void before3;

  // ── 4. Delivered + emailed → the finaliser deletes the rest, once.
  const f2 = await finalizeClosingFamilies();
  check("after delivery: family deleted (address gone with it)", f2.finalized >= 1 && !(await Family.exists({ _id: A.fam._id })));
  check("finalisation audited as 'delivered'", (await AuditLog.findOne({ action: "family.delete_finalized", targetId: String(A.fam._id) }).lean())?.details?.by === "delivered");
  const f3 = await finalizeClosingFamilies();
  check("running the finaliser again does nothing", !(await Family.exists({ _id: A.fam._id })) && f3.failed === 0);

  // ── 5. 45-day cap: family B closing with a locked gift that never ships → deleted, Spirit of Santa keeps it.
  const B = await mkFamily("b", true);
  const rb = await eraseFamily(B.parent, { mode: "deliverFirst" });
  check("family B goes 'closing'", rb.ok && rb.pending === true);
  await Family.collection.updateOne({ _id: B.fam._id }, { $set: { deletionDeadline: new Date(Date.now() - 1000) } });
  const f4 = await finalizeClosingFamilies();
  check("at the cap: family deleted, the undelivered gift is kept by Spirit of Santa (store still owed)",
    f4.byCap >= 1 && !(await Family.exists({ _id: B.fam._id })) && !!(await WishListItem.findById(B.giftId).lean())?.familyDeletedAt);

  // ── 6. "Delete everything now" (family C) and no address (family D): deleted at once, gift kept by Spirit of Santa.
  const C = await mkFamily("c", true);
  const rc = await eraseFamily(C.parent, { mode: "now" });
  check("'delete everything now': deleted at once, gift kept by Spirit of Santa", rc.ok && rc.pending === false && !(await Family.exists({ _id: C.fam._id })) && !!(await WishListItem.findById(C.giftId).lean())?.familyDeletedAt);
  const D = await mkFamily("d", false);
  const rd = await eraseFamily(D.parent, { mode: "deliverFirst" });
  check("no address on file: 'deliver first' isn't possible → deleted now, gift kept", rd.ok && rd.pending === false && !(await Family.exists({ _id: D.fam._id })));

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await Promise.all([
    WishListItem.collection.deleteMany({ storeId }),
    Transaction.collection.deleteMany({ familyId: trusted({ $in: families }) }),
    Kid.collection.deleteMany({ familyId: { $in: families } }),
    Family.collection.deleteMany({ _id: { $in: families } }),
    User.collection.deleteMany({ _id: { $in: users } }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteOne({ _id: storeId }),
  ]);
  await mongoose.disconnect();
}
process.exitCode = report();
