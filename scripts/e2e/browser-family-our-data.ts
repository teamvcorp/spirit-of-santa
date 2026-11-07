/**
 * Real-browser E2E (Edge) for Phase 8 slice 2b: /parent/our-data ("What we store about your family", COPPA review
 * right) and its JSON download.
 *
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-our-data.ts http://localhost:3000
 *
 * *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { hashSecret } from "@repo/auth/password";
import { sealJson } from "@repo/auth/sealed";
import { connectDb, Deed, Family, Item, Kid, KidVote, Store, Transaction, trusted, User, WishListItem } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-our-data.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `data pass ${tag}`;
const PIN = "8158";
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const year = getSeasonYear();

async function mkFamily(n: string) {
  const user = await User.create({ email: `e2e-data-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active", name: `Pat ${n}` });
  const fam = await Family.create({ ownerUserId: user._id, familyName: `Data${n}${tag}`, alias: `Elves${n}`, zip: "50588", parentPinHash: await hashSecret(PIN), consent: { version: "2026-11-07-draft", acceptedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
  const kid = await Kid.create({ familyId: fam._id, firstName: `Ivy${n}${tag}`, birthYear: 2017, displayName: "I.", availableCentipoints: 700, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
  return { user, fam, kid };
}
const A = await mkFamily("a");
const B = await mkFamily("b");
await Family.updateOne({ _id: A.fam._id }, { $set: { deliveryAddressEnc: sealJson({ name: "Pat A", line1: "7 Holly Lane", line2: "", city: "Ames", state: "IA", zip: "50010" }, String(A.fam._id), "ADDRESS_ENCRYPTION_KEY"), deliveryAddressUpdatedAt: new Date() } });
const storeId = oid();
const itemId = oid();
await Store.collection.insertOne({ _id: storeId, name: `Data Shop ${tag}`, slug: `e2e-data-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
await Item.collection.insertOne({ _id: itemId, storeId, seasonYear: year, name: `Kazoo ${tag}`, priceCents: 500, inventory: 3, status: "active", createdAt: new Date(), updatedAt: new Date() });
await WishListItem.collection.insertOne({ kidId: A.kid._id, familyId: A.fam._id, itemId, storeId, seasonYear: year, costCentipoints: 500, fundedCentipoints: 200, status: "active", createdAt: new Date(), updatedAt: new Date() });
await Deed.collection.insertOne({ kidId: A.kid._id, familyId: A.fam._id, seasonYear: year, locale: "en", status: "pending", customDescription: `Raked leaves ${tag}`, customReview: "pending", qrTokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 86_400_000), createdAt: new Date(), updatedAt: new Date() });
await KidVote.collection.insertOne({ kidId: A.kid._id, familyId: A.fam._id, seasonYear: year, day: "2026-11-02", vote: "nice", createdAt: new Date(), updatedAt: new Date() });
await Transaction.collection.insertOne({ kidId: A.kid._id, familyId: A.fam._id, seasonYear: year, type: "earn_tip", amountCentipoints: 900, createdAt: new Date() });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const main = (p: Page) => p.locator("main:visible").first();

try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/signin`);
  await ready(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });

  // Locked: the download refuses without the PIN.
  const locked = await page.request.get(`${base}/parent/our-data/download`, { maxRedirects: 0 });
  check("download refuses without the PIN (403)", locked.status() === 403);

  await page.goto(`${base}/parent/our-data`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  await ready(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent/our-data"), { timeout: 60_000 });
  // The data section streams in (Suspense): wait for it before reading the page.
  await main(page).getByTestId("download").waitFor({ timeout: 60_000 });
  const text = await main(page).innerText();
  check("page shows the parent and the family", text.includes(A.user.email) && text.includes(`Dataa${tag}`) && text.includes("Elvesa"), text.slice(0, 120));
  check("page shows the child's name, birth year and the deed in their own words", text.includes(`Ivya${tag}`) && text.includes("2017") && text.includes(`Raked leaves ${tag}`));
  check("page shows the wish list gift, the vote, the decrypted address and the consent version", text.includes(`Kazoo ${tag}`) && text.includes("nice") && text.includes("7 Holly Lane") && text.includes("2026-11-07-draft"));
  check("page never shows the other family's child", !text.includes(`Ivyb${tag}`));

  const dl = await page.request.get(`${base}/parent/our-data/download`);
  const body = await dl.text();
  check("download works once unlocked: JSON attachment, never cached",
    dl.status() === 200 && (dl.headers()["content-type"] ?? "").includes("application/json") && (dl.headers()["content-disposition"] ?? "").includes("attachment") && (dl.headers()["cache-control"] ?? "").includes("no-store"));
  const json = JSON.parse(body) as { children: { firstName: string; goodDeeds: unknown[]; magicHistory: unknown[] }[]; family: { deliveryAddress: { line1: string } | null } };
  check("download has the child, their deeds, the Christmas Magic history and the address", json.children.length === 1 && json.children[0]?.firstName === `Ivya${tag}` && json.children[0].goodDeeds.length === 1 && json.children[0].magicHistory.length === 1 && json.family.deliveryAddress?.line1 === "7 Holly Lane");
  check("download holds NO secrets (hashes, encrypted blobs, token hashes)", !/passwordHash|parentPinHash|argon2|Enc"|qrTokenHash|donationTokenHash|\$argon/.test(body));
  check("download never includes the other family", !body.includes(`Ivyb${tag}`) && !body.includes(B.user.email));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  const fams = [A.fam._id, B.fam._id];
  await Promise.all([
    WishListItem.collection.deleteMany({ familyId: { $in: fams } }),
    Deed.collection.deleteMany({ familyId: { $in: fams } }),
    KidVote.collection.deleteMany({ familyId: { $in: fams } }),
    Transaction.collection.deleteMany({ familyId: { $in: fams } }),
    Kid.collection.deleteMany({ familyId: { $in: fams } }),
    Family.deleteMany({ _id: trusted({ $in: fams }) }),
    User.deleteMany({ _id: trusted({ $in: [A.user._id, B.user._id] }) }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteOne({ _id: storeId }),
  ]);
  await mongoose.disconnect();
}
process.exitCode = report();
