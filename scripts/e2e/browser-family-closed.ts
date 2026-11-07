/**
 * Real-browser E2E (Edge) for year-round slice 2: the family site is CLOSED Dec 26–31 and waits ("resetting") on
 * Jan 1 until last season's reset has run. Season pages show a friendly "back January 1" card; the parent area,
 * data rights (our-data, delete), sign-in and legal pages keep working; kid registration refuses server-side.
 *
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-closed.ts http://localhost:3000
 *
 * Simulates "closed" by setting THIS season's first closed day to today (and "resetting" with a running reset record
 * for last season), then puts the Season document back exactly. *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { hashSecret } from "@repo/auth/password";
import { connectDb, Family, Kid, Season, SeasonReset, User } from "@repo/db";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { startRegistration } from "@repo/families/registration";
import { getSeasonState } from "@repo/stores/season";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-closed.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const PW = `closed pass ${tag}`;
const PIN = "8159";
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const Y = getSeasonYear();
if ((await getSeasonState()).phase !== "open") throw new Error("refusing: run this while the season is open (it simulates the closure)");
if (await SeasonReset.exists({ seasonYear: Y - 1 })) throw new Error(`refusing: a real reset record for ${Y - 1} exists`);
const savedSeason = await Season.collection.findOne({ year: Y });

const user = await User.create({ email: `e2e-closed-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active", name: "Pat Closed" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Closed${tag}`, alias: "Elves", zip: "50588", parentPinHash: await hashSecret(PIN), consent: { version: "2026-11-07-draft", acceptedAt: new Date() } });
await User.updateOne({ _id: user._id }, { $set: { familyId: fam._id } });
const kid = await Kid.create({ familyId: fam._id, firstName: `Noel${tag}`, birthYear: 2017, displayName: "N.", registration: { status: "registered", registeredAt: new Date(), method: "card" } });
const waiting = await Kid.create({ familyId: fam._id, firstName: `Wren${tag}`, birthYear: 2018, displayName: "W.", registration: { status: "awaiting" } });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const ready = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const closedCard = (p: Page) => p.locator('[data-testid="season-closed"]');
/** Open a page and report whether the closed card shows (and with which reason). */
async function gateOn(p: Page, path: string): Promise<string | null> {
  await p.goto(`${base}${path}`);
  await p.locator("main").first().waitFor({ timeout: 60_000 });
  await p.waitForLoadState("networkidle").catch(() => {});
  return (await closedCard(p).count()) ? await closedCard(p).first().getAttribute("data-reason") : null;
}

let page: Page | undefined;
try {
  page = await (await browser.newContext()).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/signin`);
  await ready(page);
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', PW);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });

  // 0. Season open: no closed card, no banner.
  check("open season: the kid page shows normally", (await gateOn(page, `/kids/${kid._id}`)) === null && (await page.getByText(`Noel${tag}`).count()) > 0);
  await page.goto(`${base}/`);
  await page.locator("main").waitFor();
  check("open season: no closed banner on home", (await page.locator('[data-testid="season-notice"]').count()) === 0);

  // 1. CLOSED (simulated: today is this season's first closed day).
  await Season.collection.updateOne({ year: Y }, { $set: { closeDate: isoDay(calendarDateIn(new Date())) } }, { upsert: true });
  check("simulated closure is in effect", (await getSeasonState()).phase === "closed");
  for (const path of [`/kids/${kid._id}`, `/kids/${kid._id}/gifts`, `/kids/${kid._id}/deed`, "/donate", "/k/not-a-real-token", "/d/not-a-real-token", "/parent/bonus", "/parent/payup", "/parent/register"]) {
    check(`closed: ${path} shows "Closed for Christmas"`, (await gateOn(page, path)) === "closed");
  }
  check("closed card names January 1 and keeps parents' rights visible", (await closedCard(page).innerText()).includes("January 1") && (await closedCard(page).innerText()).includes("delete"));
  await page.goto(`${base}/`);
  await page.locator('[data-testid="season-notice"]').waitFor({ timeout: 60_000 });
  check("home shows the closed banner", (await page.locator('[data-testid="season-notice"]').getAttribute("data-reason")) === "closed");

  // Parent area + data rights stay open.
  await page.goto(`${base}/parent`);
  // The parent area is behind the PIN even while closed (fresh session: always asked).
  await page.waitForURL((u) => u.pathname.endsWith("/parent/pin"), { timeout: 60_000 });
  await ready(page);
  await page.fill('[name="pin"]', PIN);
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => u.pathname.endsWith("/parent"), { timeout: 60_000 });
  await page.locator('[data-testid="season-notice"]').waitFor({ timeout: 60_000 });
  check("parent area opens during the closure, with the banner", (await page.locator('[data-testid="season-notice"]').count()) === 1);
  check("closed: 'What we store' (our-data) still works", (await gateOn(page, "/parent/our-data")) === null && (await page.locator("main h1").innerText()).length > 0);
  check("closed: 'Delete account' still works", (await gateOn(page, "/parent/delete-account")) === null && (await page.locator('main input[name="password"]').count()) > 0);

  // Server side: registration refuses even without the page.
  const reg = await startRegistration({ id: String(user._id), familyId: String(fam._id) }, [String(waiting._id)], "", base, (p) => p);
  check("closed: kid registration refused server-side (seasonClosed)", reg.kind === "error" && reg.error === "seasonClosed", JSON.stringify(reg));


  // Signed out: legal pages + sign-in unaffected.
  const anon = await (await browser.newContext()).newPage();
  for (const path of ["/privacy", "/terms", "/signin"]) check(`closed: ${path} still opens (no closed card)`, (await gateOn(anon, path)) === null);
  // Spanish (in this separate browser: visiting /es sets the language cookie for the rest of a session).
  check("Spanish closed card", (await gateOn(anon, "/es/donate")) === "closed" && (await closedCard(anon).innerText()).includes("Cerrado por Navidad"));

  // 2. RESETTING (Jan 1 before last season's reset is done): same card, "getting ready" words.
  if (savedSeason) await Season.collection.replaceOne({ _id: savedSeason._id }, savedSeason);
  else await Season.collection.deleteOne({ year: Y });
  await SeasonReset.collection.insertOne({ _id: new mongoose.Types.ObjectId(), seasonYear: Y - 1, status: "running", createdAt: new Date(), updatedAt: new Date() });
  check("simulated reset wait is in effect", (await getSeasonState()).phase === "resetting");
  const resetReason = await gateOn(page, `/kids/${kid._id}`);
  const resetText = resetReason ? await closedCard(page).innerText() : (await page.locator("main").first().innerText()).slice(0, 120);
  check("resetting: kid page shows 'Getting the new season ready'", resetReason === "resetting" && resetText.includes("Getting the new season ready"), `${resetReason}: ${resetText}`);
  await SeasonReset.collection.deleteOne({ seasonYear: Y - 1 });
  check("reset done: the kid page is back", (await gateOn(page, `/kids/${kid._id}`)) === null);

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  // Where it stopped (URL + first lines of the page): no personal data, test accounts only.
  if (page) console.error("at", page.url(), (await page.locator("body").innerText().catch(() => "")).slice(0, 400));
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  if (savedSeason) await Season.collection.replaceOne({ _id: savedSeason._id }, savedSeason);
  else await Season.collection.deleteOne({ year: Y });
  await SeasonReset.collection.deleteOne({ seasonYear: Y - 1, status: "running" });
  await Kid.collection.deleteMany({ familyId: fam._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteOne({ _id: user._id });
  await mongoose.disconnect();
}
process.exit(report());
