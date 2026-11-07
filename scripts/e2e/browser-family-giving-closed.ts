/**
 * E2E (Edge) for "giving closes at the freeze date" (year-round slice 5, owner 2026-11-07: gifts must arrive by
 * Christmas, keep the disclosure small).
 *  - Season open: the QR page and the donation-link page show the tip/give form with ONE small "Giving closes
 *    after {date}" line.
 *  - Freeze date reached (Dec 1-25): a deed can still be THANKED (no money), but there is no tip form, no
 *    pay-later section; the donation link shows the small "closed" note; the servers refuse tips, donation
 *    links and bonus magic ("seasonClosed"), whatever the page shows.
 *
 *   family dev server on :3000, then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *        scripts/e2e/browser-family-giving-closed.ts http://localhost:3000
 *
 * Needs the season OPEN today. *_dev database only. Creates and removes all its own data, restores the Season doc.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { connectDb, Deed, Family, Kid, Season, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { deedToken, donationToken, hashDeedToken } from "@repo/deeds/qr";
import { startDonation } from "@repo/deeds/donate";
import { startTip, thankDeed } from "@repo/deeds/public";
import { startBonus } from "@repo/families/bonus";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { getSeasonState } from "@repo/stores/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-giving-closed.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
if ((await getSeasonState()).phase !== "open") throw new Error("refusing: needs the season open today");
const year = getSeasonYear();
const savedSeason = await Season.collection.findOne({ year });
const user = await User.create({ email: `e2e-give-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(`give pass ${tag}`), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Give${tag}`, consent: { version: "test", acceptedAt: new Date() } });
await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
const kid = await Kid.create({ familyId: fam._id, firstName: `Gwen${tag}`, birthYear: 2017, displayName: "G.", registration: { status: "registered", registeredAt: new Date(), method: "card" }, donationLinkVersion: 1 });
const linkToken = donationToken(String(kid._id), 1);
await Kid.updateOne({ _id: kid._id }, { $set: { donationTokenHash: hashDeedToken(linkToken) } });
async function deed() {
  const _id = new mongoose.Types.ObjectId();
  const token = deedToken(String(_id));
  await Deed.collection.insertOne({ _id, kidId: kid._id, familyId: fam._id, seasonYear: year, locale: "en", status: "pending", qrTokenHash: hashDeedToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000), createdAt: new Date(), updatedAt: new Date() });
  return { id: _id, token };
}
const d1 = await deed();
const d2 = await deed();
const parent = { id: String(user._id), familyId: String(fam._id) };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage(); // a stranger: never signed in
page.on("pageerror", (e) => errors.push(e.message));
/** Open a public page and wait for its real content (never the season gate's aria-busy placeholder). */
const open = async (path: string) => {
  await page.goto(`${base}${path}`);
  await page.locator("main h1, main [role=alert]:not([aria-busy=true])").first().waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector("main [aria-busy=true]"), undefined, { timeout: 60_000 });
  return page.locator("main").innerText();
};
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });

try {
  // 1. Open season: forms + the one small line.
  const qrOpen = await open(`/d/${d1.token}`);
  check("open: QR page has the tip form and the small 'Giving closes after …' line",
    (await page.locator("main [data-testid=giving-note]").count()) === 1 && /Giving closes after [A-Z][a-z]+ \d+ so every gift arrives by Christmas/.test(qrOpen));
  const linkOpen = await open(`/k/${linkToken}`);
  check("open: donation link has its form and the small line", (await page.locator("main [data-testid=giving-note]").count()) === 1 && linkOpen.includes("Continue to payment"));

  // 2. Freeze date reached (today): giving closed.
  await Season.collection.updateOne({ year }, { $set: { year, freezeDate: isoDay(calendarDateIn(new Date())), forceFrozen: false } }, { upsert: true });
  const qrFrozen = await open(`/d/${d1.token}`);
  check("frozen: QR page offers 'Say thank you' but no tip form and no pay-later section",
    qrFrozen.includes("Say thank you") && (await page.locator("main [data-testid=giving-closed]").count()) === 1 && (await page.locator('main input[name="amount"], main input[name="phone"], main input[type="tel"]').count()) === 0, qrFrozen.slice(0, 300));
  await hydrated(page);
  await page.locator("main button[type=submit]", { hasText: "Say thank you" }).click();
  await page.locator("main [role=status], main [role=alert]").filter({ hasText: /Thank you|feliz|happy/i }).first().waitFor({ timeout: 60_000 });
  check("frozen: the deed is thanked (no money)", (await Deed.findById(d1.id).lean())?.status === "confirmed");
  const linkFrozen = await open(`/k/${linkToken}`);
  check("frozen: donation link shows the small 'closed' note instead of the form", linkFrozen.includes("Giving for this Christmas has closed") && !linkFrozen.includes("Continue to payment"));

  // 3. Servers refuse money whatever the page shows (hand-made requests).
  const tip = await startTip(d2.token, 1000, base, (p) => p);
  const don = await startDonation(linkToken, 1000, base, (p) => p);
  const bon = await startBonus(parent, String(kid._id), 1000, base, (p) => p);
  check("frozen: tip, donation link and bonus checkouts all refused (seasonClosed)",
    !tip.ok && tip.error === "seasonClosed" && !don.ok && don.error === "seasonClosed" && !bon.ok && bon.error === "seasonClosed", JSON.stringify([tip, don, bon]));
  check("frozen: thanking still works server-side", (await thankDeed(d2.token)).ok === true);

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
  await Deed.collection.deleteMany({ kidId: kid._id });
  await Kid.collection.deleteOne({ _id: kid._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteOne({ _id: user._id });
  await mongoose.disconnect();
}
process.exit(report());
