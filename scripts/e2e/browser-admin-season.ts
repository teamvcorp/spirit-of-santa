/**
 * Real-browser E2E (Edge) for Phase 3 slice 2: admin season controls (/season).
 *
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-season.ts http://localhost:3002
 *   (dev or `next start`; no emails involved)
 *
 * Uses its own MFA admin (createMfaAdmin). Changes this season's switches and NEXT season's
 * dates in the *_dev DB and restores both Season documents exactly afterwards.
 * Assumes "today" is after this season's opening date (so its dates are locked), as on the day
 * it was written (Nov 2026); the lock check is skipped otherwise.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, Season, SeasonReset, User } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { getSeasonState } from "@repo/stores/season";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-admin-season.ts <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const Y = getSeasonYear();
const N = Y + 1;
const before = { cur: await Season.findOne({ year: Y }).lean(), next: await Season.findOne({ year: N }).lean() };
const admin = await createMfaAdmin(`e2e-season-${tag}@spiritofsanta.test`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
/** The Card (section) whose heading contains `title`. */
const card = (title: string) => page.locator("main section, main div.rounded-2xl").filter({ has: page.locator("h2", { hasText: title }) }).first();
const seasonDoc = (year: number) => Season.findOne({ year }).lean();
const audits = (action: string) => AuditLog.countDocuments({ actorUserId: new mongoose.Types.ObjectId(admin.id), action });

try {
  // 0. Signed out → sign-in.
  await page.goto(`${base}/season`);
  await page.waitForURL(/\/signin/, { timeout: 15_000 }).catch(() => {});
  check("signed-out visitor is sent to sign-in from /season", page.url().includes("/signin"));

  // 1. Sign in (password + code) and open the page.
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
  await page.goto(`${base}/season`);
  await page.locator('[data-testid="season-phase"]').waitFor({ timeout: 15_000 });
  // The app's own rule (including the Jan 1 reset gate), not a re-implementation.
  const expected = await getSeasonState();
  const phaseText = await page.locator('[data-testid="season-phase"]').innerText();
  const phaseWord = { resetting: "Starting the new season", open: "Open", frozen: "Frozen", closed: "Closed for Christmas" }[expected.phase];
  check("status matches the rule book", phaseText.startsWith(phaseWord), phaseText);
  check("header has a Season link", (await page.locator('header a[href$="/season"]').count()) > 0);

  // 2. Store item window: open now → saved, shown, audited; then back to automatic.
  const win = card("Store item window");
  await hydrated(page);
  await win.locator('input[value="open"]').check();
  await win.locator("button[type=submit]").click();
  await page.locator('[data-testid="season-window"]').filter({ hasText: "Open for changes" }).waitFor({ timeout: 15_000 });
  check("item window 'Open now' saved and shown", (await seasonDoc(Y))?.storeWindow === "open");
  check("…audited with before/after", (await audits("season.store_window")) === 1);
  await hydrated(page);
  await card("Store item window").locator('input[value="auto"]').check();
  await card("Store item window").locator("button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="season-window"]')?.textContent?.includes("Automatic"));
  check("back to Automatic", (await seasonDoc(Y))?.storeWindow === "auto");

  // 3. Emergency freeze needs the confirmation tick; then unfreeze.
  const frz = card("Emergency freeze");
  await hydrated(page);
  await frz.locator('input[name="confirm"]').check();
  await frz.locator("button[type=submit]").click();
  await card("Emergency freeze").locator("button", { hasText: "Unfreeze" }).waitFor({ timeout: 15_000 });
  check("freeze on (DB + audit)", (await seasonDoc(Y))?.forceFrozen === true && (await audits("season.force_freeze")) === 1);
  if (expected.phase === "open") {
    check("status shows 'Frozen (frozen by an admin)' during an open season", (await page.locator('[data-testid="season-phase"]').innerText()).includes("frozen by an admin"));
  }
  await hydrated(page);
  await card("Emergency freeze").locator("button", { hasText: "Unfreeze" }).click();
  await card("Emergency freeze").locator("button", { hasText: "Freeze wish lists now" }).waitFor({ timeout: 15_000 });
  check("unfreeze works", (await seasonDoc(Y))?.forceFrozen === false);

  // 4. Year-round: the season always opens Jan 1, so there is NO opening-date field; this season's dates lock at
  //    its freeze date.
  const cur = card(`Dates for season ${Y}`);
  check("no opening-date field (the season opens January 1)", (await page.locator('input[name="openDate"]').count()) === 0);
  if (expected.datesLocked) {
    check("this season's dates are locked after its freeze date (fields disabled, no save button)",
      (await cur.locator('input[name="freezeDate"]').isDisabled()) && (await cur.locator("button[type=submit]").count()) === 0 && (await cur.innerText()).includes("dates are locked"));
  } else {
    check("before its freeze date this season's dates can still change", !(await cur.locator('input[name="freezeDate"]').isDisabled()));
  }

  // 5. Next season: a freeze date out of range refused; valid dates saved + audited; blank = back to defaults.
  const nxt = () => card(`Dates for season ${N}`);
  await hydrated(page);
  await nxt().locator('input[name="freezeDate"]').fill(`${N}-12-10`); // after Dec 3: no time to ship by Dec 10
  await nxt().locator("button[type=submit]").click();
  await nxt().locator('[role="alert"]').filter({ hasText: "between November 1 and December 3" }).waitFor({ timeout: 15_000 });
  check("a freeze date after Dec 3 is refused with a clear message", !(await seasonDoc(N))?.freezeDate);
  check("…and the typed date is kept (not wiped)", (await nxt().locator('input[name="freezeDate"]').inputValue()) === `${N}-12-10`);
  await hydrated(page);
  await nxt().locator('input[name="freezeDate"]').fill(`${N}-11-20`);
  await nxt().locator('input[name="closeDate"]').fill(`${N}-12-28`);
  await nxt().locator("button[type=submit]").click();
  await nxt().locator('[role="status"]').filter({ hasText: "Saved." }).waitFor({ timeout: 15_000 });
  const saved = await seasonDoc(N);
  check("next season's custom dates saved", saved?.freezeDate === `${N}-11-20` && saved.closeDate === `${N}-12-28`);
  const dateAudit = await AuditLog.findOne({ actorUserId: new mongoose.Types.ObjectId(admin.id), action: "season.dates" }).lean();
  check("…audited with before/after", (dateAudit?.details as { to?: { freezeDate?: string } } | undefined)?.to?.freezeDate === `${N}-11-20`);
  await hydrated(page);
  for (const f of ["freezeDate", "closeDate"]) await nxt().locator(`input[name="${f}"]`).fill("");
  await nxt().locator("button[type=submit]").click();
  // The previous "Saved." is still on screen until this action returns: wait for the DB instead.
  let cleared = await seasonDoc(N);
  for (let i = 0; i < 30 && cleared?.freezeDate; i++) {
    await page.waitForTimeout(500);
    cleared = await seasonDoc(N);
  }
  check("blank dates = back to the standard calendar", !cleared?.freezeDate && !cleared?.closeDate);

  // 5b. A Jan 1 reset that hasn't finished: the page says "Starting the new season" and offers the manual run.
  //     (Seeds a RUNNING reset record for last season; skipped if a real one exists or it is Dec 26–31.)
  if (expected.phase !== "closed" && !(await SeasonReset.exists({ seasonYear: Y - 1 }))) {
    // Raw insert: the model refuses years before the app existed (2026), and the 2026 season has no "last season".
    const seeded = { _id: new mongoose.Types.ObjectId(), seasonYear: Y - 1, status: "running", createdAt: new Date(), updatedAt: new Date() };
    await SeasonReset.collection.insertOne(seeded);
    try {
      await page.goto(`${base}/season`);
      await page.locator('[data-testid="season-resetting"]').waitFor({ timeout: 15_000 });
      check("unfinished reset: status says 'Starting the new season'", (await page.locator('[data-testid="season-phase"]').innerText()).startsWith("Starting the new season"));
      check("…and the 'Run the season reset now' button is offered", (await page.getByRole("button", { name: "Run the season reset now" }).count()) === 1);
    } finally {
      await SeasonReset.collection.deleteOne({ _id: seeded._id });
    }
  } else {
    console.log("(skipped the resetting check: a real reset record exists or the season is closed)");
  }

  // 6. Spanish.
  await page.goto(`${base}/es/season`);
  await page.locator("main h1").filter({ hasText: "Configuración de la temporada" }).waitFor({ timeout: 15_000 });
  check("Spanish page", true);

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  // Put both Season documents back exactly as they were.
  for (const [year, doc] of [[Y, before.cur], [N, before.next]] as const) {
    if (doc) await Season.collection.replaceOne({ _id: doc._id }, doc);
    else await Season.collection.deleteOne({ year });
  }
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await User.collection.deleteOne({ _id: new mongoose.Types.ObjectId(admin.id) });
  await mongoose.disconnect();
}
process.exit(report());
