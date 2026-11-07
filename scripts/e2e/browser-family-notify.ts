/**
 * Real-browser E2E (Edge) for Phase 7 slice 1: parent email settings, the /unsubscribe page
 * (opening it changes nothing; the button does) and the one-click POST /api/unsubscribe.
 *
 *   family dev server on :3000 (restart after model changes), then:
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-notify.ts http://localhost:3000
 *
 * *_dev database only; creates and removes all its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Family, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { optOutLinksFor, unsubscribeToken } from "@repo/families/notifications";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-notify.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `notify pass ${tag}`;
const PIN = "8156";

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const user = await User.create({ email: `e2e-notify-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Notify${tag}`, parentPinHash: await hashSecret(PIN), consent: { version: "test", acceptedAt: new Date() } });
await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
const FID = String(fam._id);
const prefs = async () => ((await Family.collection.findOne({ _id: fam._id })) as { notify?: Record<string, unknown> } | null)?.notify ?? {};

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
  // 1. Email settings (PIN): all ON by default; switch "Magic received" off.
  await page.goto(`${base}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${base}/parent`);
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  await hydrated(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 60_000 });
  await main().getByRole("link", { name: "Email settings" }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/parent/notifications"), { timeout: 60_000 });
  await main().locator('input[name="magic"]').waitFor({ timeout: 60_000 });
  const boxes = await main().locator("input[type=checkbox]").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
  check("email settings: three kinds, all ON by default", boxes.length === 3 && boxes.every(Boolean));
  await hydrated(page);
  await main().locator('input[name="magic"]').uncheck();
  await main().getByRole("button", { name: "Save" }).click();
  await main().locator("[role=status]", { hasText: "Saved" }).waitFor({ timeout: 60_000 });
  const p1 = await prefs();
  check("saved: magic OFF, the others ON; audited", p1.magic === false && p1.deeds === true && p1.reminders === true && (await AuditLog.countDocuments({ action: "family.notify_prefs", targetId: fam._id })) === 1);

  // 2. Unsubscribe page: OPENING it changes nothing (mail scanners open links); the button does.
  const links = optOutLinksFor(FID, "deeds", "en");
  check("email links point at the family site's /unsubscribe, /api/unsubscribe and settings pages", links.optOut.includes("/unsubscribe?t=") && links.oneClick.includes("/api/unsubscribe?t=") && links.manage.endsWith("/parent/notifications"));
  await page.goto(`${base}/unsubscribe?t=${encodeURIComponent(unsubscribeToken(FID, "deeds"))}`);
  await main().getByRole("button", { name: /Stop "Good deeds thanked" emails/ }).waitFor({ timeout: 60_000 });
  check("opening the unsubscribe page alone changes nothing", (await prefs()).deeds === true);
  await hydrated(page);
  await main().getByRole("button", { name: /Stop "Good deeds thanked" emails/ }).click();
  await main().locator("[role=status]", { hasText: "won't get" }).waitFor({ timeout: 60_000 });
  check("button: 'Good deeds thanked' switched OFF, audited as an unsubscribe link", (await prefs()).deeds === false && (await AuditLog.countDocuments({ action: "family.notify_prefs", targetId: fam._id, "details.by": "unsubscribe_link" })) === 1);

  // 3. Tampered link: refused.
  const bad = unsubscribeToken(FID, "reminders").replace("reminders", "magic");
  await page.goto(`${base}/unsubscribe?t=${encodeURIComponent(bad)}`);
  await main().locator("[role=alert]").first().waitFor({ timeout: 60_000 });
  check("tampered unsubscribe link: 'not valid', no button", (await main().innerText()).includes("isn't valid") && (await main().locator("button[type=submit]").count()) === 0);

  // 4. One-click (RFC 8058) POST from a mail provider: no sign-in, only that kind, GET does nothing.
  const oneClick = `${base}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(FID, "reminders"))}`;
  const g = await fetch(oneClick);
  check("GET on the one-click endpoint does nothing (405)", g.status === 405 && (await prefs()).reminders === true);
  const r = await fetch(oneClick, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
  check("one-click POST: 200 and 'Season reminders' OFF", r.status === 200 && (await prefs()).reminders === false);
  const rb = await fetch(`${base}/api/unsubscribe?t=${encodeURIComponent(bad)}`, { method: "POST" });
  check("one-click POST with a tampered token: 400", rb.status === 400);

  // 5. Turning it back on in settings works (the link only ever switches OFF).
  await page.goto(`${base}/parent/notifications`);
  await main().locator('input[name="reminders"]').waitFor({ timeout: 60_000 });
  await hydrated(page);
  await main().locator('input[name="reminders"]').check();
  await main().getByRole("button", { name: "Save" }).click();
  await main().locator("[role=status]", { hasText: "Saved" }).waitFor({ timeout: 60_000 });
  check("parent turned 'Season reminders' back on", (await prefs()).reminders === true);

  check("no browser errors", errors.length === 0);
  if (errors.length) console.log(errors);
} finally {
  await browser.close();
  await Promise.all([
    AuditLog.collection.deleteMany({ targetId: fam._id }),
    Family.deleteOne({ _id: fam._id }),
    User.deleteMany({ _id: trusted({ $in: [user._id] }) }),
  ]);
  await mongoose.disconnect();
}
report();
