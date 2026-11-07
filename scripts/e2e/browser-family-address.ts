/**
 * E2E for Phase 6 slice 4b: the family DELIVERY address (encrypted, PIN-protected, asked for only
 * while a gift is on its way, deleted after delivery). Real browser (Edge) for the parent pages;
 * the admin side through the same service the admin page uses.
 *
 *   family dev server on :3000 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-address.ts http://localhost:3000
 *
 * *_dev database only; creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, Item, Kid, RateLimit, Store, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { addressState, saveAddress } from "@repo/families/address";
import { getSeasonYear } from "@repo/lib/season";
import { adminFulfilment, markSentToFamily, purgeUnneededAddresses } from "@repo/wishlists/fulfilment";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-address.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `address pass ${tag}`;
const PIN = "8155";
const STREET = `${Number.parseInt(tag.slice(0, 4), 16)} Candy Cane Lane`; // unique, to look for in raw data
const year = getSeasonYear();

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const mkFamily = async (n: string) => {
  const user = await User.create({ email: `e2e-addr-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const family = await Family.create({ ownerUserId: user._id, familyName: `Addr${n}${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: family._id } });
  return { user, family, parent: { id: String(user._id), familyId: String(family._id) } };
};
const A = await mkFamily("a");
const B = await mkFamily("b");
const admin = await User.create({ email: `e2e-addr-admin-${tag}@spiritofsanta.test`, passwordHash: "x".repeat(60), role: "admin", status: "active" });
const registered = { status: "registered", registeredAt: new Date(), method: "card" };
const kidA = await Kid.create({ familyId: A.family._id, firstName: `Ada${tag}`, birthYear: 2016, displayName: "A.", registration: registered });
const kidB = await Kid.create({ familyId: B.family._id, firstName: `Ben${tag}`, birthYear: 2016, displayName: "B.", registration: registered });
const storeId = oid();
await Store.collection.insertOne({ _id: storeId, name: `Addr Shop ${tag}`, slug: `e2e-addr-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
const itemId = oid();
await Item.collection.insertOne({ _id: itemId, storeId, seasonYear: year, name: `Train ${tag}`, priceCents: 2000, inventory: 3, status: "active", createdAt: new Date(), updatedAt: new Date() });
const wish = async (k: { _id: unknown; familyId: unknown }, fields: Record<string, unknown>) => {
  const _id = oid();
  await WishListItem.collection.insertOne({ _id, kidId: k._id, familyId: k.familyId, itemId, storeId, seasonYear: year, costCentipoints: 2000, fundedCentipoints: 2000, fullyFundedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ...fields });
  return String(_id);
};
const famRaw = (id: unknown) => Family.collection.findOne({ _id: id as never });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const main = () => page.locator("main:visible");

try {
  // 1. No gift on its way → no address asked for, and the server refuses to store one.
  const early = await saveAddress(A.parent, { name: "Ada Parent", line1: STREET, line2: "", city: "Austin", state: "TX", zip: "78701" });
  check("no gift on its way: server refuses to store an address", !early.ok && early.error === "notNeeded");
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/parent/address`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin") && u.searchParams.get("next") === "/parent/address", { timeout: 60_000 });
  check("address page needs the parent PIN (and comes back after)", true);
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent/address"), { timeout: 60_000 });
  await main().locator('[data-testid="not-needed"]').waitFor({ timeout: 60_000 });
  check("no gift on its way: page explains, shows no form", (await main().locator('input[name="line1"]').count()) === 0);

  // 2. A gift is locked in → dashboard prompts → form.
  const wA = await wish(kidA, { status: "locked", lockedAt: new Date() });
  await page.goto(`${base}/parent`);
  await main().locator('[data-testid="address-alert"]').waitFor({ timeout: 60_000 });
  check("funded gift + no address: dashboard asks for one", true);
  await main().getByRole("link", { name: "Add a delivery address" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent/address"), { timeout: 60_000 });
  await main().locator('input[name="line1"]').waitFor({ timeout: 60_000 });
  await hydrated(page);
  await page.fill('main:visible [name="name"]', "Ada Parent");
  await page.fill('main:visible [name="line1"]', STREET);
  await page.fill('main:visible [name="city"]', "Austin");
  await page.selectOption('main:visible select[name="state"]', "TX");
  await page.fill('main:visible [name="zip"]', "7870"); // wrong
  await page.locator("main:visible form").first().evaluate((f) => f.setAttribute("novalidate", "")); // let the SERVER judge it
  await page.locator("main:visible form button[type=submit]").first().click();
  await main().locator("[role=alert]", { hasText: "5-digit ZIP" }).waitFor({ timeout: 60_000 });
  check("server rejects a bad ZIP, names the field, keeps what was typed", (await page.inputValue('main:visible [name="line1"]')) === STREET);
  await hydrated(page);
  await page.fill('main:visible [name="zip"]', "78701");
  await page.locator("main:visible form button[type=submit]").first().click();
  await main().locator("[role=status]", { hasText: "Address saved" }).waitFor({ timeout: 60_000 });
  check("valid address saved", true);

  // 2b. Delete from the page: clear feedback, empty form; then save again (service) for the next steps.
  await hydrated(page);
  await main().getByRole("button", { name: "Delete address" }).click();
  await main().locator("[role=status]", { hasText: "Address deleted" }).waitFor({ timeout: 60_000 });
  check("delete: 'Address deleted.' shown, no stale 'saved' message, form empty",
    (await main().locator("[role=status]", { hasText: "Address saved" }).count()) === 0 && (await page.inputValue('main:visible [name="line1"]')) === "" && !(await famRaw(A.family._id))?.deliveryAddressEnc);
  const odd = await saveAddress(A.parent, { name: "Ada Parent", line1: "1 Main\u202E St", line2: "", city: "Austin", state: "TX", zip: "78701" }); // \u202E = right-to-left override
  check("invisible right-to-left override characters are refused", !odd.ok && odd.error === "invalid" && odd.field === "line1");
  const spaced = await saveAddress(A.parent, { name: "Ada Parent", line1: STREET, line2: "   ", city: "Austin", state: "TX", zip: "78701" });
  check("optional apartment line with only spaces is accepted as blank", spaced.ok && (await addressState(A.parent))?.saved?.line2 === "");

  // 3. Stored encrypted, hidden from ordinary queries, audited without content.
  const raw = await famRaw(A.family._id);
  check("stored ENCRYPTED: the street never appears in the database", typeof raw?.deliveryAddressEnc === "string" && raw.deliveryAddressEnc.startsWith("v1.") && !JSON.stringify(raw).includes("Candy Cane"));
  const plain = await Family.findById(A.family._id).lean();
  check("ordinary queries don't even load it (select: false)", plain !== null && !("deliveryAddressEnc" in plain));
  const audit = await AuditLog.findOne({ action: "family.address_update", targetId: A.family._id }).lean();
  check("change audited WITHOUT the address", !!audit && !JSON.stringify(audit).includes("Candy Cane"));
  const mine = await addressState(A.parent);
  check("parent sees their own address back (decrypted)", mine?.saved?.line1 === STREET && mine.saved.zip === "78701");

  // 4. Bound to the family: the same ciphertext copied onto family B does NOT decrypt there.
  await wish(kidB, { status: "locked", lockedAt: new Date() });
  await Family.collection.updateOne({ _id: B.family._id }, { $set: { deliveryAddressEnc: raw!.deliveryAddressEnc } });
  const stolen = await addressState(B.parent);
  check("ciphertext copied to another family can't be read there (bound to the family id)", stolen?.saved === null && stolen.unreadable === true);
  await Family.collection.updateOne({ _id: B.family._id }, { $unset: { deliveryAddressEnc: 1 } });

  // 5. Admin: shown only for gifts to send, every view audited; family B shows "missing".
  await WishListItem.collection.updateOne({ _id: new mongoose.Types.ObjectId(wA) }, { $set: { status: "shipped", shippedAt: new Date(), receivedAt: new Date() } });
  const f = await adminFulfilment(String(admin._id));
  const rowA = f.toSend.rows.find((r) => r.id === wA);
  check("admin 'To send' shows the decrypted address lines", Array.isArray(rowA?.address) && rowA.address.join("|") === `Ada Parent|${STREET}|Austin, TX 78701`);
  await adminFulfilment(String(admin._id)); // a refresh of the queue
  check("admin views audited ONCE per admin, family and day (refreshes don't flood the log)", (await AuditLog.countDocuments({ action: "family.address_view", targetId: A.family._id, actorUserId: admin._id })) === 1);

  // 6. Sent to family = last gift on its way → address deleted (and audited).
  const sent = await markSentToFamily(String(admin._id), wA);
  const after = await famRaw(A.family._id);
  check("last gift sent: address deleted automatically", sent.ok && !after?.deliveryAddressEnc && (await AuditLog.countDocuments({ action: "family.address_delete", targetId: A.family._id, "details.by": "delivered", actorUserId: admin._id })) === 1);

  // 7. Daily purge: an address left behind with no gift on its way is deleted.
  await Family.collection.updateOne({ _id: A.family._id }, { $set: { deliveryAddressEnc: raw!.deliveryAddressEnc } });
  const purged = await purgeUnneededAddresses();
  check("daily purge deletes addresses no gift needs any more, audited as the system", purged >= 1 && !(await famRaw(A.family._id))?.deliveryAddressEnc && (await AuditLog.countDocuments({ action: "family.address_delete", targetId: A.family._id, "details.by": "purge", actorUserId: trusted({ $exists: false }) })) === 1);

  // 8. Parent can delete it themselves (family B, gift still on its way).
  await saveAddress(B.parent, { name: "Ben Parent", line1: "1 Elf Road", line2: "", city: "Ames", state: "IA", zip: "50010" });
  check("family B saved an address while its gift is on its way", !!(await famRaw(B.family._id))?.deliveryAddressEnc);

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  const fams = [A.family._id, B.family._id];
  await Promise.all([
    WishListItem.collection.deleteMany({ familyId: { $in: fams } }),
    AuditLog.collection.deleteMany({ $or: [{ targetId: { $in: fams } }, { actorUserId: admin._id }] }),
    RateLimit.collection.deleteMany({ key: { $regex: `^address-view-audit:${String(admin._id)}:` } }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteMany({ _id: trusted({ $in: [kidA._id, kidB._id] }) }),
    Family.deleteMany({ _id: trusted({ $in: fams }) }),
    User.deleteMany({ _id: trusted({ $in: [A.user._id, B.user._id, admin._id] }) }),
  ]);
  await mongoose.disconnect();
}
report();
