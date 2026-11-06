/**
 * Real-browser E2E (Edge) for Phase 3 slice 5: admin dashboard (admin home page).
 *
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-dashboard.ts http://localhost:3002
 *
 * Read-only apart from its own MFA admin (created and removed). Each tile is compared with a
 * count the test makes itself, straight from the *_dev DB.
 */
import { randomBytes } from "node:crypto";
import { chromium } from "playwright-core";
import { AuditLog, connectDb, DeedType, Store, User } from "@repo/db";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-admin-dashboard.ts <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const admin = await createMfaAdmin(`e2e-dash-${tag}@spiritofsanta.test`);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
/** The number in the tile whose label is exactly `label`. */
const tile = async (label: string) => {
  const dd = page.locator("main dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label.replace(/[()]/g, "\\$&")}$`) }) }).locator("dd");
  return Number((await dd.innerText()).replace(/[^\d]/g, ""));
};

try {
  // Signed out: intro only, no numbers.
  await page.goto(`${base}/`);
  await page.locator("main h1").waitFor({ timeout: 15_000 });
  check("signed out: no dashboard data", (await page.locator("main dl").count()) === 0);

  await page.goto(`${base}/signin`);
  await page.waitForFunction(() => [...document.querySelectorAll("main button[type=submit]")].every((b) => !(b as HTMLButtonElement).disabled));
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });
  await page.goto(`${base}/`);
  await page.locator("main dl").first().waitFor({ timeout: 15_000 });

  const [admins, approved, deeds] = await Promise.all([
    User.countDocuments({ role: "admin", status: "active" }),
    Store.countDocuments({ status: "approved" }),
    DeedType.countDocuments({ active: true }),
  ]);
  check("admins tile matches the database (incl. this test's admin)", (await tile("Admins (active)")) === admins, `${await tile("Admins (active)")} vs ${admins}`);
  check("approved stores tile matches", (await tile("Approved stores")) === approved);
  check("deeds tile matches", (await tile("Deeds in the catalog")) === deeds);
  check("season line shown", (await page.locator('[data-testid="dash-season"]').innerText()).includes("Season"));
  const latest = await AuditLog.findOne().sort({ createdAt: -1 }).lean();
  check("recent activity lists the newest audit entry", !latest || (await page.locator('[data-testid="recent-activity"]').innerText()).includes(latest.action));
  check("pending-stores link kept", (await page.locator("main").innerText()).match(/stores? waiting for review/) !== null);

  await page.goto(`${base}/es`);
  await page.locator("main").getByText("Cuentas").first().waitFor({ timeout: 15_000 });
  check("Spanish dashboard", true);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await User.collection.deleteOne({ _id: new mongoose.Types.ObjectId(admin.id) });
  await mongoose.disconnect();
}
process.exit(report());
