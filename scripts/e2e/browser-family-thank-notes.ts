/**
 * E2E (Edge) for thank-you notes on a child's QR page (owner 2026-11-07): someone without money says thank you with
 * a READY-MADE note; the parent approves it before the child sees it, and can add Christmas Magic for the deed.
 *  1. Stranger picks a note + "Say thank you" → deed confirmed, note stored as a key, waiting for the parent.
 *  2. The child's page does NOT show it yet.
 *  3. Parent area (PIN) lists it with the child and deed; "Add Christmas Magic" links to bonus for that child.
 *  4. Approve → the child's page shows it. A second family's parent can't review it. Hiding works too.
 *  5. The server ignores anything that isn't one of the ready-made notes.
 *
 *   family dev server on :3000, then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *        scripts/e2e/browser-family-thank-notes.ts http://localhost:3000
 * Needs the season open or frozen. *_dev database only. Creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { connectDb, Deed, Family, Kid, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { deedToken, hashDeedToken } from "@repo/deeds/qr";
import { reviewThankNote } from "@repo/deeds/deeds";
import { thankDeed } from "@repo/deeds/public";
import { getSeasonYear } from "@repo/lib/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-thank-notes.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const year = getSeasonYear();
const PW = `notes pass ${tag}`;
const PIN = "4826";

async function mkFamily(n: string) {
  const user = await User.create({ email: `e2e-note-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  const fam = await Family.create({ ownerUserId: user._id, familyName: `Note${n}${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
  await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
  const kid = await Kid.create({ familyId: fam._id, firstName: `Nora${n}${tag}`, birthYear: 2017, displayName: "N.", registration: { status: "registered", registeredAt: new Date(), method: "card" } });
  return { user, fam, kid, parent: { id: String(user._id), familyId: String(fam._id) } };
}
async function mkDeed(kid: { _id: unknown; familyId: unknown }, text: string) {
  const _id = new mongoose.Types.ObjectId();
  const token = deedToken(String(_id));
  await Deed.collection.insertOne({ _id, kidId: kid._id, familyId: kid.familyId, seasonYear: year, locale: "en", status: "pending", qrTokenHash: hashDeedToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000), customDescription: text, customReview: "approved", createdAt: new Date(), updatedAt: new Date() });
  return { id: _id, token };
}
const A = await mkFamily("a");
const B = await mkFamily("b");
const d1 = await mkDeed(A.kid, `Carried groceries ${tag}`);
const d2 = await mkDeed(A.kid, `Raked leaves ${tag}`);
const d3 = await mkDeed(A.kid, `Fed the cat ${tag}`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });

try {
  // 1. A stranger (no session) leaves a note.
  const stranger = await (await browser.newContext()).newPage();
  stranger.on("pageerror", (e) => errors.push(e.message));
  await stranger.goto(`${base}/d/${d1.token}`);
  await stranger.locator('main [data-testid="thank-note"]').waitFor({ timeout: 60_000 });
  await hydrated(stranger);
  await stranger.locator('main input[name="note"][value="madeMyDay"]').check();
  await stranger.locator("main button[type=submit]", { hasText: "Say thank you" }).click();
  await stranger.locator("main").getByText(/will be so happy/).first().waitFor({ timeout: 60_000 });
  const saved = await Deed.findById(d1.id).lean();
  check("stranger's note saved as a key, waiting for the parent; deed thanked", saved?.status === "confirmed" && saved.outcome === "thanked" && saved.thankNote === "madeMyDay" && saved.thankNoteReview === "pending");

  // 5. Only ready-made notes are accepted (a crafted value is ignored, the thanks still counts).
  const forged = await thankDeed(d2.token, "<b>call me 555-1234</b>" as never);
  const d2row = await Deed.findById(d2.id).lean();
  check("server ignores anything that isn't a ready-made note", forged.ok && !d2row?.thankNote && !d2row?.thankNoteReview);
  await thankDeed(d3.token, "soKind");

  // Parent A signs in.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', A.user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });

  // 2. Not on the child's page yet.
  await page.goto(`${base}/kids/${A.kid._id}`);
  await page.locator('main [data-testid="kid-deeds"]').waitFor({ timeout: 60_000 });
  check("child's page does NOT show a note before the parent approves it", (await page.locator('main [data-testid="deed-note"]').count()) === 0);

  // 3. Parent area (PIN).
  await page.goto(`${base}/parent`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 60_000 });
  const card = page.locator('main [data-testid="thank-notes"]');
  await card.waitFor({ timeout: 60_000 });
  const cardText = await card.innerText();
  check("parent sees both notes with the child's name and the deed", cardText.includes("You made my day. Thank you!") && cardText.includes(`NoraA${tag}`.replace("A", "a")) && cardText.includes(`Carried groceries ${tag}`) && cardText.includes("That was so kind of you"), cardText.slice(0, 200));
  const magicHref = await page.locator(`main li[data-deed="${d1.id}"] a`, { hasText: "Add Christmas Magic" }).getAttribute("href");
  check("'Add Christmas Magic for this deed' goes to bonus magic for that child", !!magicHref && magicHref.includes(`/parent/bonus?kid=${A.kid._id}`), magicHref ?? "");

  // 4. Another family can't review it; then A approves one and hides the other.
  check("another family's parent can't review the note", !(await reviewThankNote(B.parent, String(d1.id), "approved")).ok && (await Deed.findById(d1.id).lean())?.thankNoteReview === "pending");
  await hydrated(page);
  await page.locator(`main li[data-deed="${d1.id}"] button`, { hasText: "Approve" }).click();
  for (let i = 0; i < 40 && (await Deed.findById(d1.id).lean())?.thankNoteReview !== "approved"; i++) await page.waitForTimeout(300);
  await page.waitForFunction((id) => !document.querySelector(`main li[data-deed="${id}"]`), String(d1.id), { timeout: 60_000 });
  await hydrated(page);
  await page.locator(`main li[data-deed="${d3.id}"] button`, { hasText: "Hide" }).click();
  for (let i = 0; i < 40 && (await Deed.findById(d3.id).lean())?.thankNoteReview !== "hidden"; i++) await page.waitForTimeout(300);
  check("approve and hide saved", (await Deed.findById(d1.id).lean())?.thankNoteReview === "approved" && (await Deed.findById(d3.id).lean())?.thankNoteReview === "hidden");

  await page.goto(`${base}/kids/${A.kid._id}`);
  await page.locator('main [data-testid="deed-note"]').first().waitFor({ timeout: 60_000 });
  const notes = await page.locator('main [data-testid="deed-note"]').allInnerTexts();
  check("child's page shows ONLY the approved note", notes.length === 1 && notes[0]!.includes("You made my day. Thank you!"), notes.join(" | "));

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const fams = [A.fam._id, B.fam._id];
  await Deed.collection.deleteMany({ familyId: { $in: fams } });
  await Kid.collection.deleteMany({ familyId: { $in: fams } });
  await Family.collection.deleteMany({ _id: { $in: fams } });
  await User.collection.deleteMany({ _id: { $in: [A.user._id, B.user._id] } });
  await mongoose.disconnect();
}
process.exit(report());
