/**
 * Real-browser E2E (Edge) for Phase 3 slice 1: admin two-step sign-in (authenticator app).
 *
 *   node --conditions=react-server --env-file=apps/admin/.env.local scripts/e2e/browser-admin-mfa.ts http://localhost:3002
 *   (dev or `next start`; no emails involved)
 *
 * Walks the real flow: new admin → restricted session → setup page (QR + key) → confirm with a
 * code computed here from the shown key → recovery codes → sign in again WITH a code. Then the
 * attacks: no code, wrong code, replayed code, reused recovery code; and the lost-phone reset.
 * Creates and deletes its own admin; never touches dev-admin@.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, RateLimit, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { resetMfa } from "@repo/auth/mfa";
import { base32Decode, totpCode, totpStep } from "@repo/auth/totp";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-admin-mfa.ts <adminUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
// Resend's test inbox: enabling MFA sends a REAL alert email under `next start` (fake domains bounce).
const email = `delivered+mfa${tag}@resend.dev`;
const PW = `mfa pass ${tag} long`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const created = await User.create({ email, passwordHash: await hashSecret(PW), role: "admin", status: "active" });
const uid = String(created._id);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function newPage() {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const hydratedSubmit = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")];
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  });
/** Sign in through the real form. Returns true if we left /signin. */
async function signInUi(p: Page, code?: string): Promise<boolean> {
  await p.goto(`${base}/signin`);
  await hydratedSubmit(p);
  await p.fill('[name="email"]', email);
  await p.fill('[name="password"]', PW);
  if (code !== undefined) await p.fill('[name="code"]', code);
  await p.click("main button[type=submit]");
  const ok = await Promise.race([
    p.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 15_000 }).then(() => true),
    p.locator('main [role="alert"]').first().waitFor({ timeout: 15_000 }).then(() => false),
  ]).catch(() => false);
  return ok;
}
const onSetup = (p: Page) => p.url().includes("/mfa/setup");
// Only "+field" entries: they ADD hidden fields to the normal ones. (A bare field name would switch
// to "only these fields" and silently drop mfa.enabled: found by this test, 2026-11-05.)
const fresh = async () => User.findById(uid).select("+mfa.secretEnc +mfa.pendingSecretEnc +mfa.lastStep +mfa.recoveryCodeHashes +failedLoginCount").lean();

try {
  // 1. First sign-in: no MFA yet → restricted session, every page leads to setup.
  const p = await newPage();
  check("first sign-in with a blank code works", await signInUi(p, ""));
  await p.goto(`${base}/`);
  await p.waitForURL(/\/mfa\/setup/, { timeout: 15_000 }).catch(() => {});
  check("home sends a no-MFA admin to /mfa/setup", onSetup(p), p.url());
  await p.goto(`${base}/stores`);
  await p.waitForURL(/\/mfa\/setup/, { timeout: 15_000 }).catch(() => {});
  check("/stores sends a no-MFA admin to /mfa/setup (no store data)", onSetup(p), p.url());

  // 2. Setup page: QR + manual key; a reload shows the SAME key.
  const keyBox = p.locator('[data-testid="mfa-manual-key"]');
  await keyBox.waitFor({ timeout: 15_000 });
  const key = (await keyBox.innerText()).trim();
  check("QR code image with alt text is shown", (await p.locator('main img[alt="QR code for your authenticator app"]').count()) === 1);
  await p.reload();
  await keyBox.waitFor({ timeout: 15_000 });
  check("reloading shows the same key (pending secret reused)", (await keyBox.innerText()).trim() === key);
  const pending = await fresh();
  check("pending secret is stored encrypted, not in clear", !!pending?.mfa?.pendingSecretEnc?.startsWith("v1.") && !pending.mfa.pendingSecretEnc.includes(key.replace(/\s/g, "")) && pending.mfa.enabled !== true);

  // 3. Wrong code, then the right one (computed from the key the page showed).
  const secret = base32Decode(key);
  const now = totpStep();
  const wrong = ["000000", "111111", "222222"].find((c) => ![now - 1, now, now + 1].some((s) => totpCode(secret, s) === c))!;
  await hydratedSubmit(p);
  await p.fill('[name="code"]', wrong);
  await p.click("main button[type=submit]");
  await p.locator("main").getByText("That code didn't match").waitFor({ timeout: 15_000 });
  check("a wrong setup code is refused with a helpful message", (await fresh())?.mfa?.enabled !== true);
  const svBefore = (await fresh())?.sessionVersion ?? 0;
  await hydratedSubmit(p);
  const setupStep = totpStep();
  await p.fill('[name="code"]', totpCode(secret, setupStep));
  await p.click("main button[type=submit]");
  await p.locator("main").getByText("Two-step sign-in is on.").waitFor({ timeout: 15_000 });
  const codes = (await p.locator('main ol[aria-label="Recovery codes"] li').allInnerTexts()).map((c) => c.trim());
  check("10 recovery codes shown once", codes.length === 10 && codes.every((c) => /^[a-z2-7]{5}-[a-z2-7]{5}$/.test(c)), JSON.stringify(codes.slice(0, 2)));
  const on = await fresh();
  check("MFA on in the DB: encrypted secret, 10 hashed codes, sessions ended",
    on?.mfa?.enabled === true && !!on.mfa.secretEnc?.startsWith("v1.") && !on.mfa.pendingSecretEnc &&
    on.mfa.recoveryCodeHashes?.length === 10 && !on.mfa.recoveryCodeHashes.includes(codes[0]!.replace("-", "")) && (on.sessionVersion ?? 0) === svBefore + 1);
  check("enabling is audited", (await AuditLog.countDocuments({ targetId: created._id, action: "user.mfa_enable" })) === 1);
  check("sign-in-again button appears only after ticking 'saved'", (await p.locator("main button", { hasText: "Sign in again" }).count()) === 0);
  await p.locator("main input[type=checkbox]").check();
  await p.locator("main button", { hasText: "Sign in again" }).click();
  await p.waitForURL(/\/signin/, { timeout: 15_000 });
  check("'Sign in again' signs out to the sign-in page", p.url().includes("/signin"));

  // 4. From now on a code is required. Blank and wrong codes fail with one generic message.
  const q = await newPage();
  check("password alone (blank code) no longer gets in", !(await signInUi(q, "")));
  check("generic failure message mentions the code", (await q.locator('main [role="alert"]').innerText()).includes("authenticator code"));
  const failsBefore = (await fresh())?.failedLoginCount ?? 0;
  check("a wrong code fails", !(await signInUi(q, wrong)));
  check("a wrong code counts toward the lockout (blank didn't)", ((await fresh())?.failedLoginCount ?? 0) === failsBefore + 1);
  // The setup code's step is already used: only a NEWER step works.
  check("the code used for setup can't be reused to sign in", !(await signInUi(q, totpCode(secret, setupStep))));
  const goodStep = Math.max(setupStep + 1, totpStep()); // newer than the setup step, valid now
  const good = totpCode(secret, goodStep);
  check("password + a fresh code signs in", await signInUi(q, good));
  await q.goto(`${base}/stores`);
  await q.locator("main h1").waitFor({ timeout: 15_000 });
  check("full admin access with MFA (no redirect to setup)", !onSetup(q) && q.url().includes("/stores"), q.url());

  // 5. Replay: the same code in another browser fails.
  const r = await newPage();
  const failsBeforeReplay = (await fresh())?.failedLoginCount ?? 0;
  check("the same code can't be used twice (replay)", !(await signInUi(r, good)));
  check("…and a replayed (correct) code isn't a strike", ((await fresh())?.failedLoginCount ?? 0) === failsBeforeReplay);

  // 6. Recovery code: works once, case/dash-insensitive.
  check("a recovery code signs in", await signInUi(r, codes[0]!.toUpperCase().replace("-", " ")));
  const s = await newPage();
  check("the same recovery code doesn't work twice", !(await signInUi(s, codes[0]!)));
  check("9 recovery codes left, use audited",
    (await fresh())?.mfa?.recoveryCodeHashes?.length === 9 && (await AuditLog.countDocuments({ targetId: created._id, action: "user.mfa_recovery_used" })) === 1);

  // 6b. Code guessing with a known password escalates: 10 wrong codes in a row → 24 h lock.
  await User.updateOne({ _id: uid }, { $set: { "mfa.failures": 9 } });
  check("10th wrong code in a row fails", !(await signInUi(s, wrong)));
  const locked = await User.findById(uid).select("+lockedUntil").lean();
  const hours = locked?.lockedUntil ? (new Date(locked.lockedUntil).getTime() - Date.now()) / 3_600_000 : 0;
  check("…locks the account for ~24 h and is audited", hours > 23 && hours <= 24 && (await AuditLog.countDocuments({ targetId: created._id, action: "user.mfa_locked" })) === 1, hours.toFixed(2));
  check("…even a valid code can't get in while locked", !(await signInUi(s, totpCode(secret, Math.max(goodStep + 1, totpStep())))));
  await User.updateOne({ _id: uid }, { $unset: { lockedUntil: 1 } });

  // 7. Lost phone: reset (what `npm run admin:create` does) → setup again at next sign-in.
  await resetMfa(uid);
  const t = await newPage();
  check("after a reset, password + blank code gets a setup-only session", await signInUi(t, ""));
  await t.goto(`${base}/stores`);
  await t.waitForURL(/\/mfa\/setup/, { timeout: 15_000 }).catch(() => {});
  check("…and is sent to /mfa/setup again", onSetup(t), t.url());

  // 8. Spanish setup page.
  await t.goto(`${base}/es/mfa/setup`);
  await t.locator("main").getByText("Configura el inicio de sesión en dos pasos").waitFor({ timeout: 15_000 });
  check("Spanish setup page", true);

  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  await AuditLog.collection.deleteMany({ $or: [{ targetId: created._id }, { actorUserId: created._id }] });
  await RateLimit.collection.deleteMany({ key: `mfa-setup:${uid}` });
  await User.collection.deleteOne({ _id: created._id });
  await mongoose.disconnect();
}
process.exit(report());
