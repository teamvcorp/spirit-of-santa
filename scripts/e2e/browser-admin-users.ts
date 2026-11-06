/**
 * Real-browser E2E (Edge) for Phase 3 slice 3: admin user management (/users).
 *
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-users.ts http://localhost:3002
 *   (dev or `next start`; no emails involved)
 *
 * Creates its own admins and test accounts in the *_dev DB and removes them afterwards.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { reinstateUser, resetUserMfa, suspendUser } from "@repo/auth/admin-users";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-admin-users.ts <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mail = (n: string) => `e2e-users-${n}-${tag}@spiritofsanta.test`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const admin = await createMfaAdmin(mail("admin"));
const admin2 = await createMfaAdmin(mail("admin2"));
const hash = await hashSecret(`users pass ${tag}`);
const owner = await User.create({ email: mail("owner"), passwordHash: hash, role: "store_owner", status: "active" });
const locked = await User.create({ email: mail("locked"), passwordHash: hash, role: "store_rep", status: "active" });
await User.updateOne({ _id: locked._id }, { $set: { lockedUntil: new Date(Date.now() + 3_600_000), failedLoginCount: 4 } });
// A rep their store removed: "suspended" but NOT by an admin.
const removedRep = await User.create({ email: mail("removed"), passwordHash: hash, role: "store_rep", status: "suspended" });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
const doc = (id: unknown) => User.findById(id).select("+lockedUntil +failedLoginCount").lean();
const audits = (action: string, target: unknown) => AuditLog.countDocuments({ actorUserId: new mongoose.Types.ObjectId(admin.id), action, targetId: target });
async function clickOp(label: string, doneText: string) {
  await hydrated(page);
  await page.locator("main form", { has: page.locator("button", { hasText: label }) }).locator("button[type=submit]").click();
  // Only the confirmation box (role=status): hints elsewhere on the page can contain the same words.
  await page.locator('main [role="status"]').filter({ hasText: doneText }).first().waitFor({ timeout: 15_000 });
}

try {
  // 0. Signed out → sign-in.
  await page.goto(`${base}/users`);
  await page.waitForURL(/\/signin/, { timeout: 15_000 }).catch(() => {});
  check("signed-out visitor is sent to sign-in from /users", page.url().includes("/signin"));
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 });

  // 1. Search + filters.
  await page.goto(`${base}/users?q=${encodeURIComponent(`e2e-users-`)}`);
  await page.locator("main table").waitFor({ timeout: 15_000 });
  const listed = await page.locator("main tbody tr").allInnerTexts();
  check("search finds the test accounts", [mail("owner"), mail("locked"), mail("admin2")].every((m) => listed.some((r) => r.includes(m))));
  await page.goto(`${base}/users?q=${encodeURIComponent(`e2e-users-`)}&role=admin`);
  await page.locator("main table").waitFor({ timeout: 15_000 });
  const admins = await page.locator("main tbody tr").allInnerTexts();
  check("role filter shows only admins (with two-step status)", admins.length >= 2 && admins.every((r) => r.includes("Admin")) && admins.some((r) => r.includes("two-step on")));
  await page.goto(`${base}/users?q=${encodeURIComponent(".*")}`);
  await page.locator("main").getByText(/account/).first().waitFor({ timeout: 15_000 });
  check("search text is literal, not a pattern ('.*' finds nothing)", (await page.locator("main tbody tr").count()) === 0);

  // 2. Suspend (reason required) → reinstate.
  const sv0 = (await doc(owner._id))?.sessionVersion ?? 0;
  await page.goto(`${base}/users/${owner._id}`);
  await page.locator("main h1").filter({ hasText: mail("owner") }).waitFor({ timeout: 15_000 });
  await hydrated(page);
  await page.fill('main [name="reason"]', "E2E: testing suspension");
  await page.locator("main button", { hasText: "Suspend account" }).click();
  await page.locator("main").getByText("Suspended. Their sessions end").waitFor({ timeout: 15_000 });
  const susp = await doc(owner._id);
  check("suspend → status suspended, sessions ended, audited with reason",
    susp?.status === "suspended" && (susp.sessionVersion ?? 0) === sv0 + 1 && (await audits("user.suspend", owner._id)) === 1);
  check("history on the page shows the reason", (await page.locator("main").innerText()).includes("E2E: testing suspension"));
  await clickOp("Reinstate", "Reinstated.");
  check("reinstate → active again, audited", (await doc(owner._id))?.status === "active" && (await audits("user.reinstate", owner._id)) === 1);

  // 3. Sign out everywhere.
  const sv1 = (await doc(owner._id))?.sessionVersion ?? 0;
  await clickOp("Sign out everywhere", "Every session will end");
  check("sign out everywhere bumps the session version, audited", ((await doc(owner._id))?.sessionVersion ?? 0) === sv1 + 1 && (await audits("user.sign_out_all", owner._id)) === 1);

  // 4. Unlock a locked account.
  await page.goto(`${base}/users/${locked._id}`);
  await page.locator("main").getByText("Sign-in is locked until").waitFor({ timeout: 15_000 });
  await clickOp("Unlock sign-in", "Unlocked.");
  const un = await doc(locked._id);
  check("unlock clears the lockout and failed tries, audited", !un?.lockedUntil && un?.failedLoginCount === 0 && (await audits("user.unlock", locked._id)) === 1);

  // 5. Reset another admin's MFA.
  await page.goto(`${base}/users/${admin2.id}`);
  await page.locator("main").getByText("recovery codes left").waitFor({ timeout: 15_000 });
  await clickOp("Reset two-step sign-in", "Two-step sign-in reset.");
  const a2 = await User.findById(admin2.id).lean();
  check("reset MFA → off for that admin, audited by the acting admin",
    !a2?.mfa?.enabled && (await audits("user.mfa_reset", new mongoose.Types.ObjectId(admin2.id))) === 1);

  // 6. Your own account: no suspend / reset.
  await page.goto(`${base}/users/${admin.id}`);
  await page.locator("main").getByText("This is your own account").waitFor({ timeout: 15_000 });
  check("own account: no suspend or MFA reset offered",
    (await page.locator('main [name="reason"]').count()) === 0 && (await page.locator("main button", { hasText: "Reset two-step" }).count()) === 0);

  // 6b. Upper-case copy of your own id can't get past the "not yourself" guard.
  const upper = admin.id.toUpperCase();
  const selfSuspend = await suspendUser(admin.id, upper, "self test");
  const selfReset = await resetUserMfa(admin.id, upper);
  check("upper-case own id is still 'yourself' (suspend + MFA reset refused)",
    !selfSuspend.ok && selfSuspend.error === "self" && !selfReset.ok && selfReset.error === "self" && (await doc(admin.id))?.status === "active");

  // 6c. A rep removed by their store can't be "reinstated" by an admin.
  await page.goto(`${base}/users/${removedRep._id}`);
  await page.locator("main").getByText("removed by their store").waitFor({ timeout: 15_000 });
  const rr = await reinstateUser(admin.id, String(removedRep._id));
  check("store-removed rep: no Reinstate button, explanation shown, service refuses",
    (await page.locator("main button", { hasText: "Reinstate" }).count()) === 0 && !rr.ok && rr.error === "removedRep" && (await doc(removedRep._id))?.status === "suspended");

  // 7. Spanish.
  await page.goto(`${base}/es/users`);
  await page.locator("main h1").filter({ hasText: "Usuarios" }).waitFor({ timeout: 15_000 });
  check("Spanish page", true);

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const users = await User.find({ email: trusted({ $regex: `-${tag}@spiritofsanta\\.test$` }) }).select("_id").lean();
  const ids = users.map((u) => u._id);
  await AuditLog.collection.deleteMany({ $or: [{ actorUserId: { $in: ids } }, { targetId: { $in: ids } }] });
  await User.collection.deleteMany({ _id: { $in: ids } });
  await mongoose.disconnect();
}
process.exit(report());
