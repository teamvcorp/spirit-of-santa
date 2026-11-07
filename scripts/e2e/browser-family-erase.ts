/**
 * Real-browser E2E (Edge) for Phase 8 slice 2a: deleting a child and deleting the whole family account
 * (COPPA deletion right, @repo/families/erase).
 *
 *   dev servers running (output logged to a file), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-erase.ts http://localhost:3000 <dev-log-file>
 *
 * Checks: open gifts released (store's set-aside unit back in stock), locked gifts KEPT with familyDeletedAt
 * (store still owed), all magic forfeited to Spirit of Santa in one ledger row, deeds/votes/child gone, the
 * delete-account page (preview, wrong word, wrong password), then family + parent gone, signed out, goodbye
 * page, confirmation email, and the admin queue offering "Keep for Spirit of Santa" instead of shipping.
 * *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Deed, Family, Item, Kid, KidVote, PayLaterRequest, Store, Transaction, trusted, User, WishListItem } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { getSeasonYear } from "@repo/lib/season";
import { makeChecks } from "./lib.ts";

const [base, logFile] = process.argv.slice(2);
if (!base || !logFile) throw new Error("usage: browser-family-erase.ts <familyUrl> <dev-log-file>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `erase pass ${tag}`;
const PIN = "8158";
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const year = getSeasonYear();

// ── Data: one family, two children. Ava: unspent magic + 3 gifts (collecting / funded+set aside / locked). Ben: deed + vote.
const user = await User.create({ email: `e2e-erase-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Erase${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date(), emailVerifiedAt: new Date() } });
await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
const reg = { status: "registered", registeredAt: new Date(), method: "card" };
// Ava: available 500; escrow 300 (collecting) + 1500 (fully funded). The LOCKED gift's 2000 was SPENT at lock
// (Phase 8: ledger "spend", not in escrow). Unspent magic = 500 + 300 + 1500 = 2300, never the locked 2000.
const ava = await Kid.create({ familyId: fam._id, firstName: `Ava${tag}`, birthYear: 2016, displayName: "A.", availableCentipoints: 500, escrowedCentipoints: 1800, registration: reg });
// Cy: escrow OUT OF SYNC (0) while a fully funded gift holds 1500 with a reserved store unit (the case that parks a
// gift at lock). Deletion must still finish (COPPA), return the store's unit, and log the shortfall.
const cy = await Kid.create({ familyId: fam._id, firstName: `Cy${tag}`, birthYear: 2019, displayName: "C.", availableCentipoints: 0, escrowedCentipoints: 0, registration: reg });
const ben = await Kid.create({ familyId: fam._id, firstName: `Ben${tag}`, birthYear: 2018, displayName: "B.", availableCentipoints: 200, registration: reg });
const storeId = oid();
await Store.collection.insertOne({ _id: storeId, name: `Erase Shop ${tag}`, slug: `e2e-erase-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
const mkItem = async (name: string, inventory: number) => {
  const _id = oid();
  await Item.collection.insertOne({ _id, storeId, seasonYear: year, name: `${name} ${tag}`, priceCents: 2000, inventory, status: "active", createdAt: new Date(), updatedAt: new Date() });
  return _id;
};
const [kiteId, sledId, bikeId] = [await mkItem("Kite", 5), await mkItem("Sled", 2), await mkItem("Bike", 1)];
const wish = (itemId: unknown, extra: Record<string, unknown>) => ({ _id: oid(), kidId: ava._id, familyId: fam._id, itemId, storeId, seasonYear: year, costCentipoints: 2000, createdAt: new Date(), updatedAt: new Date(), ...extra });
const collecting = wish(kiteId, { status: "active", fundedCentipoints: 300 });
const funded = wish(sledId, { status: "fully_funded", fundedCentipoints: 1500, fullyFundedAt: new Date(), inventoryReserved: true });
const locked = wish(bikeId, { status: "locked", fundedCentipoints: 2000, fullyFundedAt: new Date(Date.now() - 40 * 86_400_000), lockedAt: new Date(), inventoryReserved: true });
await WishListItem.collection.insertMany([collecting, funded, locked]);
const drumId = await mkItem("Drum", 4);
await WishListItem.collection.insertOne({ _id: oid(), kidId: cy._id, familyId: fam._id, itemId: drumId, storeId, seasonYear: year, costCentipoints: 1500, fundedCentipoints: 1500, status: "fully_funded", fullyFundedAt: new Date(), inventoryReserved: true, createdAt: new Date(), updatedAt: new Date() });
// The locked gift's spend, as the engine books it at lock.
await Transaction.collection.insertOne({ kidId: ava._id, familyId: fam._id, seasonYear: year, type: "spend", amountCentipoints: 2000, wishListItemId: locked._id, idempotencyKey: `spend:${String(locked._id)}`, createdAt: new Date() });
// Unique token hash per deed (index); the free-text description is what deletion must remove.
const benDeedId = oid();
await Deed.collection.insertOne({ _id: benDeedId, kidId: ben._id, familyId: fam._id, seasonYear: year, locale: "en", status: "pending", customDescription: `Helped a neighbour ${tag}`, customReview: "pending", qrTokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() });
// A visitor's live "pay later" text request for Ben's deed (no Stripe link id: closed without a Stripe call).
const plrId = oid();
await PayLaterRequest.collection.insertOne({ _id: plrId, deedId: benDeedId, kidId: ben._id, familyId: fam._id, active: true, status: "sent", phoneKey: "a".repeat(64), consentAt: new Date(), consentVersion: "test", consentLocale: "en", amountCents: 500, expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() });
await KidVote.collection.insertOne({ kidId: ben._id, familyId: fam._id, seasonYear: year, day: "2026-11-01", vote: "nice", createdAt: new Date(), updatedAt: new Date() });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const main = (p: Page) => p.locator("main:visible").first();

try {
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  // Sign in + PIN.
  await page.goto(`${base}/signin`);
  await ready(page);
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/parent`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  await ready(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 60_000 });

  // ── 1. Delete ONE child (Ava) through the existing form.
  await main(page).getByText(`Ava${tag}`).first().waitFor({ timeout: 60_000 });
  const avaRow = main(page).locator("li", { hasText: `Ava${tag}` }).filter({ has: page.locator('input[name="confirm"]') }).first();
  await avaRow.locator('input[name="confirm"]').check();
  await ready(page);
  await avaRow.getByRole("button", { name: "Delete child" }).click();
  await main(page).getByText(`Ava${tag}`).first().waitFor({ state: "detached", timeout: 60_000 });
  check("Ava is gone from the parent page", (await main(page).getByText(`Ava${tag}`).count()) === 0);
  check("Ava's record is deleted", !(await Kid.exists({ _id: ava._id })));
  const rows = await WishListItem.find({ kidId: ava._id }).lean();
  check("open gifts (collecting + funded) are gone; only the LOCKED gift stays", rows.length === 1 && String(rows[0]?._id) === String(locked._id));
  check("the locked gift stays deliverable: the family still exists (no familyDeletedAt)", !rows[0]?.familyDeletedAt && rows[0]?.status === "locked");
  const sled = await Item.findById(sledId).lean();
  check("the store's set-aside unit for the funded gift is back in stock (2 → 3)", sled?.inventory === 3);
  const bike = await Item.findById(bikeId).lean();
  check("the locked gift's unit stays with the order (1)", bike?.inventory === 1);
  const forfeit = await Transaction.find({ kidId: ava._id, type: "forfeit" }).lean();
  check("Ava's UNSPENT magic (500 + 300 + 1500) went to Spirit of Santa in ONE forfeit row, not the locked gift's 2000", forfeit.length === 1 && forfeit[0]?.amountCentipoints === 2300, `forfeit ${forfeit[0]?.amountCentipoints}`);
  const releases = await Transaction.countDocuments({ kidId: ava._id, type: "release" });
  check("both open gifts were released through the engine first (2 ledger releases)", releases === 2);
  const avaAudit = await AuditLog.findOne({ action: "kid.delete", targetId: String(ava._id) }).lean();
  check("the deletion is audited without names, and found the books in order (no escrow left over)", !!avaAudit && !(avaAudit.details as { escrowLeftCentipoints?: number } | undefined)?.escrowLeftCentipoints);
  check("the locked gift keeps its ONE spend (deletion never forfeits spent magic again)", (await Transaction.countDocuments({ wishListItemId: locked._id, type: "spend" })) === 1 && (await Transaction.countDocuments({ wishListItemId: locked._id, type: "forfeit" })) === 0);

  // ── 1b. "Lock" really locks (it now expires the cookie with its own options: __Host- names in production).
  await page.goto(`${base}/parent`);
  await ready(page);
  await main(page).getByRole("button", { name: "Lock (back to kids)" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/parent"), { timeout: 60_000 });
  await page.goto(`${base}/parent`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  check("Lock relocks the parent area (PIN asked again)", true);
  await ready(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 60_000 });

  // ── 2. Delete the WHOLE family.
  await page.goto(`${base}/parent`);
  await main(page).getByRole("link", { name: "Delete our family account" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent/delete-account"), { timeout: 60_000 });
  await ready(page);
  const preview = await main(page).getByTestId("erase-preview").innerText();
  // Ben (2 available) + Cy (open gift holding 15) = 17 Christmas Magic; 2 children left.
  check("the page says what happens: 2 children, 17 Christmas Magic to Spirit of Santa", preview.includes("2 children") && preview.includes("17 Christmas Magic"), preview.replace(/s+/g, " ").slice(0, 200));
  check("…and that the 1 gift already on its way is kept", preview.includes("One gift is already on its way"));
  const submit = async (password: string, word: string) => {
    await ready(page);
    await page.fill('main:visible [name="password"]', password);
    await page.fill('main:visible [name="confirm"]', word);
    await page.click("main:visible button[type=submit]");
  };
  await submit(PW, "delet");
  await main(page).getByText("Type the word exactly").waitFor({ timeout: 60_000 });
  check("a wrong confirmation word is refused (nothing deleted)", !!(await Family.exists({ _id: fam._id })));
  await submit("not the password", "DELETE");
  await main(page).getByText("That password isn't right").waitFor({ timeout: 60_000 });
  check("a wrong password is refused (nothing deleted)", !!(await Family.exists({ _id: fam._id })));
  const logBefore = readFileSync(logFile, "utf8").length;
  await submit(PW, "delete"); // any capitals
  await page.waitForURL((u) => u.pathname.endsWith("/account-deleted"), { timeout: 60_000 });
  check("lands on the goodbye page", (await main(page).innerText()).includes("Your family account was deleted"));
  check("the header no longer shows a signed-in parent", !(await page.locator("header").innerText()).includes(user.email));

  check("family, parent and Ben are deleted", !(await Family.exists({ _id: fam._id })) && !(await User.exists({ _id: user._id })) && !(await Kid.exists({ _id: ben._id })));
  check("Ava's earlier locked gift is now KEPT by Spirit of Santa (no family left to send it to)", !!(await WishListItem.findById(locked._id).lean())?.familyDeletedAt);
  const plr = await PayLaterRequest.findById(plrId).lean();
  check("the visitor's live pay-later link is switched off; their consent record stays", plr?.status === "closed" && !plr.active);
  const cyAudit = await AuditLog.findOne({ action: "kid.delete", targetId: String(cy._id) }).lean();
  check("Cy (escrow out of sync) is still deleted; the shortfall is logged, not hidden", !(await Kid.exists({ _id: cy._id })) && (cyAudit?.details as { shortfallCentipoints?: number } | undefined)?.shortfallCentipoints === 1500);
  check("…and the store's set-aside Drum unit went back to stock (4 → 5)", (await Item.findById(drumId).lean())?.inventory === 5);
  check("Ben's deed (free text) and vote are deleted", !(await Deed.exists({ kidId: ben._id })) && !(await KidVote.exists({ kidId: ben._id })));
  const benForfeit = await Transaction.find({ kidId: ben._id, type: "forfeit" }).lean();
  check("Ben's 2 Christmas Magic went to Spirit of Santa", benForfeit.length === 1 && benForfeit[0]?.amountCentipoints === 200);
  check("the ledger is kept (anonymised: its ids point at nothing)", (await Transaction.countDocuments({ familyId: fam._id })) >= 4);
  check("family deletion audited", !!(await AuditLog.exists({ action: "family.delete", targetId: String(fam._id) })));

  await page.goto(`${base}/parent`);
  await page.waitForURL((u) => u.pathname.includes("signin"), { timeout: 60_000 });
  check("this browser is signed out (the parent area asks to sign in)", true);
  await new Promise((r) => setTimeout(r, 1500));
  const mail = readFileSync(logFile, "utf8").slice(logBefore);
  check("confirmation email sent to the parent", mail.includes("Your Spirit of Santa family account was deleted") && mail.includes(user.email));

  // ── 3. Admin queue: the store ships the locked gift, Spirit of Santa receives it → "Keep", never "Send".
  await WishListItem.updateOne({ _id: locked._id }, { $set: { status: "shipped", shippedAt: new Date(), receivedAt: new Date() } });
  const { adminFulfilment, markSentToFamily } = await import("@repo/wishlists/fulfilment");
  const admin = await User.create({ email: `e2e-erase-admin-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "admin", status: "active" });
  try {
    const q = await adminFulfilment(String(admin._id));
    const row = q.toSend.rows.find((r) => r.id === String(locked._id));
    check("admin 'to send' shows it as a deleted family's gift, with no address", !!row?.familyDeletedAt && row.address === undefined);
    const closed = await markSentToFamily(String(admin._id), String(locked._id));
    check("'Keep for Spirit of Santa' closes the row (no family email: nobody to tell)", closed.ok && (await WishListItem.findById(locked._id).lean())?.status === "delivered");
  } finally {
    await User.deleteOne({ _id: admin._id });
  }
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await Promise.all([
    WishListItem.collection.deleteMany({ familyId: fam._id }),
    Item.collection.deleteMany({ storeId }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteMany({ familyId: fam._id }),
    Deed.collection.deleteMany({ familyId: fam._id }),
    KidVote.collection.deleteMany({ familyId: fam._id }),
    PayLaterRequest.collection.deleteMany({ familyId: fam._id }),
    Transaction.collection.deleteMany({ familyId: fam._id }),
    Family.deleteOne({ _id: fam._id }),
    User.deleteMany({ _id: trusted({ $in: [user._id] }) }),
  ]);
  await mongoose.disconnect();
}
process.exitCode = report();
