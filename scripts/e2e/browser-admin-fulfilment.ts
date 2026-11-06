/**
 * Real-browser E2E (Edge) for Phase 6 slice 3b: the admin /fulfilment page (substitute arranged,
 * received, sent to family) and the parent's "gift on its way" email.
 *
 *   admin dev server on :3002 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-fulfilment.ts http://localhost:3002
 *
 * Uses its own MFA admin. *_dev database only; creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, Item, Kid, Store, trusted, User, WishListItem } from "@repo/db";
import { renderEmail } from "@repo/email";
import { getSeasonYear } from "@repo/lib/season";
import { markReceived, markSentToFamily, orderRef as ref, sendFamilyNotices } from "@repo/wishlists/fulfilment";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-admin-fulfilment.ts <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const year = getSeasonYear();

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const admin = await createMfaAdmin(`e2e-ful-${tag}@spiritofsanta.test`);

const parent = await User.create({ email: `e2e-ful-parent-${tag}@spiritofsanta.test`, passwordHash: "x".repeat(60), role: "parent", status: "active", locale: "es" });
const fam = await Family.create({ ownerUserId: parent._id, familyName: `Ful${tag}`, consent: { version: "test", acceptedAt: new Date() } });
const kid = await Kid.create({ familyId: fam._id, firstName: `Nia${tag}`, birthYear: 2016, displayName: "N.", registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const storeId = oid();
await Store.collection.insertOne({ _id: storeId, name: `Ful Shop ${tag}`, slug: `e2e-ful-${tag}`, status: "approved", contact: { email: `shop-${tag}@spiritofsanta.test` }, createdAt: new Date(), updatedAt: new Date() });
const itemId = oid();
await Item.collection.insertOne({ _id: itemId, storeId, seasonYear: year, name: `Sled ${tag}`, priceCents: 3000, inventory: 0, status: "active", createdAt: new Date(), updatedAt: new Date() });
const wish = async (fields: Record<string, unknown>) => {
  const _id = oid();
  await WishListItem.collection.insertOne({ _id, kidId: kid._id, familyId: fam._id, itemId, storeId, seasonYear: year, costCentipoints: 3000, fundedCentipoints: 3000, fullyFundedAt: new Date(Date.now() - 40 * 86_400_000), createdAt: new Date(), updatedAt: new Date(), ...fields });
  return String(_id);
};
const sub = await wish({ status: "locked", needsSubstitute: true, readyNotifiedAt: new Date() });
const transit = await wish({ status: "shipped", shippedAt: new Date(), trackingNote: "UPS 1ZTEST" });
const received = await wish({ status: "shipped", shippedAt: new Date(), receivedAt: new Date() });
const retry = await wish({ status: "delivered", shippedAt: new Date(), receivedAt: new Date(), deliveredAt: new Date() }); // email never went out
const all = [sub, transit, received, retry];
const get = (id: string) => WishListItem.findById(id).lean();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const section = (id: string) => page.locator(`main:visible [data-testid="${id}"]`);
const row = (id: string, wishId: string) => section(id).locator(`li[data-ref="${ref(wishId)}"]`);

try {
  // 0. Signed out → sign-in.
  await page.goto(`${base}/fulfilment`);
  await page.waitForURL(/\/signin/, { timeout: 60_000 }).catch(() => {});
  check("signed-out visitor is sent to sign-in from /fulfilment", page.url().includes("/signin"));

  // 1. Sign in (password + code) → nav link → page.
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.locator('a[href$="/fulfilment"]').first().click();
  await page.waitForURL((u) => u.pathname.endsWith("/fulfilment"), { timeout: 60_000 });
  await section("substitutes").waitFor({ timeout: 60_000 });
  check("nav link opens /fulfilment with all four sections", (await section("in-transit").count()) === 1 && (await section("to-send").count()) === 1 && (await section("delivered").count()) === 1);
  check("in transit: our gift with its tracking note; who it's for is NOT shown yet", (await row("in-transit", transit).innerText()).includes("UPS 1ZTEST") && !(await row("in-transit", transit).innerText()).includes(`Nia${tag}`));

  // 2. Substitute arranged → back in the store's queue (and the next store email).
  await hydrated(page);
  await row("substitutes", sub).locator("textarea").fill("Red sled instead of blue (same price)");
  await row("substitutes", sub).getByRole("button", { name: "Substitute arranged" }).click();
  await row("substitutes", sub).waitFor({ state: "detached", timeout: 60_000 });
  const s1 = await get(sub);
  check("substitute: flag cleared, note saved, store will be told again", !s1?.needsSubstitute && s1?.substituteNote === "Red sled instead of blue (same price)" && !!s1.substituteArrangedAt && !s1.readyNotifiedAt);

  // 3. Received.
  await hydrated(page);
  await row("in-transit", transit).getByRole("button", { name: "Received" }).click();
  await row("to-send", transit).waitFor({ timeout: 60_000 });
  check("Received: moves to 'To send', receivedAt recorded by this admin", String((await get(transit))?.receivedByUserId) === admin.id);
  const toSendText = await row("to-send", received).innerText();
  check("To send: shows who it's for (child, family, parent email)", toSendText.includes(`Nia${tag}`) && toSendText.includes(`Ful${tag}`) && toSendText.includes(parent.email));

  // 4. Sent to family → delivered + parent emailed.
  await hydrated(page);
  await row("to-send", received).getByRole("button", { name: "Sent to family" }).click();
  await row("delivered", received).waitFor({ timeout: 60_000 });
  const d = await get(received);
  check("Sent to family: delivered, by this admin, parent email sent", d?.status === "delivered" && String(d.deliveredByUserId) === admin.id && !!d.familyNotifiedAt);
  check("delivered list says 'parent emailed'", (await row("delivered", received).innerText()).includes("parent emailed"));
  check("every step audited", (await AuditLog.countDocuments({ targetId: trusted({ $in: [sub, transit, received] }), action: trusted({ $in: ["wish.substitute", "wish.receive", "wish.deliver"] }) })) === 3);

  // 5. The email itself (parent's language = Spanish here): kid's name, item, link to the kid page.
  const mailEs = renderEmail("giftOnItsWay", { link: `http://localhost:3000/es/kids/${kid._id}`, kidName: kid.firstName, itemName: `Sled ${tag}` }, "es");
  check("email (es): subject + child + item + link", mailEs.subject.includes("va en camino") && mailEs.text.includes(`Nia${tag}`) && mailEs.text.includes(`Sled ${tag}`) && mailEs.text.includes(`/es/kids/${kid._id}`));

  // 6. Server refuses out-of-order steps.
  const [a, b, c] = [await markReceived(admin.id, received), await markSentToFamily(admin.id, sub), await markReceived(admin.id, "not-an-id")];
  check("server: received twice / send before received → changed; bad id → notFound", !a.ok && a.error === "changed" && !b.ok && b.error === "changed" && !c.ok && c.error === "notFound");

  // 7. Daily retry of a missed parent email.
  const n = await sendFamilyNotices();
  check("daily job emails a parent whose 'on its way' email was missed", n.sent >= 1 && !!(await get(retry))?.familyNotifiedAt);

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  const ids = all.map((id) => new mongoose.Types.ObjectId(id));
  await Promise.all([
    WishListItem.collection.deleteMany({ _id: { $in: ids } }),
    AuditLog.collection.deleteMany({ $or: [{ targetId: { $in: ids } }, { actorUserId: new mongoose.Types.ObjectId(admin.id) }] }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteOne({ _id: kid._id }),
    Family.deleteOne({ _id: fam._id }),
    User.deleteMany({ _id: trusted({ $in: [parent._id, admin.id] }) }),
  ]);
  await mongoose.disconnect();
}
report();
