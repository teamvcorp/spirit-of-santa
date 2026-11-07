/**
 * E2E for the Phase 8 audit fix: lockouts can't be raced with PARALLEL guesses (packages/auth/src/attempts.ts).
 *
 *   dev servers running with their output logged to a file (npm run dev > log), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \n *     scripts/e2e/auth-race.ts http://localhost:3000 http://localhost:3002 <dev-log-file>
 *
 * 1. Helper: 50 simultaneous reserveAttempt calls on one account grant EXACTLY 5; self-heal; release.
 * 2. Real sign-in: 30 parallel wrong passwords, then the RIGHT one → refused (locked), and the server
 *    verified at most 5 passwords during the burst (counted from the "[auth] sign-in refused" log lines).
 * 3. Password reset (real form): a PENDING parent becomes active WITH the COPPA consent email stamp, and a
 *    reset does NOT clear the 24 h lock of an admin with two-step sign-in.
 * *_dev database only; creates and removes its own data.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { connectDb, Family, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { failAttempt, PIN_ATTEMPTS, releaseAttempt, reserveAttempt } from "../../packages/auth/src/attempts.ts";
import { LOGIN_ATTEMPTS } from "../../packages/auth/src/options.ts";
import { createActionToken } from "@repo/auth/tokens";
import { createMfaAdmin, makeChecks, signIn, submitForm } from "./lib.ts";

const [base, adminBase, logFile] = process.argv.slice(2);
if (!base || !adminBase || !logFile) throw new Error("usage: auth-race.ts <familyUrl> <adminUrl> <dev-log-file>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const PW = `race pass ${tag}`;
const made: unknown[] = [];
const newParent = async (n: string) => {
  const u = await User.create({ email: `e2e-race-${n}-${tag}@spiritofsanta.test`, passwordHash: await hashSecret(PW), role: "parent", status: "active" });
  made.push(u._id);
  return u;
};
const state = async (id: unknown) => User.findById(id).select("+failedLoginCount +lockedUntil").lean();

try {
  // 1a. 50 at once → exactly 5 granted.
  const a = await newParent("a");
  const me = { _id: a._id };
  const granted = (await Promise.all(Array.from({ length: 50 }, () => reserveAttempt(User, me, LOGIN_ATTEMPTS)))).filter(Boolean).length;
  check("50 simultaneous tries: exactly 5 get through", granted === 5, `granted ${granted}`);
  // All 5 fail → locked, count reset.
  await Promise.all(Array.from({ length: 5 }, () => failAttempt(User, me, LOGIN_ATTEMPTS)));
  const s1 = await state(a._id);
  check("5 failures lock the account and reset the count", !!s1?.lockedUntil && s1.lockedUntil > new Date() && s1.failedLoginCount === 0);
  check("while locked, no try is granted", !(await reserveAttempt(User, me, LOGIN_ATTEMPTS)));

  // 1b. Self-heal: count stuck at max with no lock (crash between reserve and fail) → locks, never stuck forever.
  const b = await newParent("b");
  await User.updateOne({ _id: b._id }, { $set: { failedLoginCount: 5 } });
  const refused = !(await reserveAttempt(User, { _id: b._id }, LOGIN_ATTEMPTS));
  const s2 = await state(b._id);
  check("stuck at the limit without a lock → locks normally (count back to 0)", refused && !!s2?.lockedUntil && s2.failedLoginCount === 0);
  await User.updateOne({ _id: b._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
  check("after the lock ends, tries are granted again", await reserveAttempt(User, { _id: b._id }, LOGIN_ATTEMPTS));

  // 1b2. A late 15-min lock never SHORTENS a longer one (e.g. the 24 h code lock): locks only grow.
  const g = await newParent("g");
  const long = new Date(Date.now() + 24 * 3_600_000);
  await User.updateOne({ _id: g._id }, { $set: { lockedUntil: long, failedLoginCount: 5 } });
  await failAttempt(User, { _id: g._id }, LOGIN_ATTEMPTS);
  check("a late failure keeps the longer 24 h lock", (await state(g._id))?.lockedUntil?.getTime() === long.getTime());

  // 1c. Release gives the slot back; never below 0.
  const c = await newParent("c");
  await reserveAttempt(User, { _id: c._id }, LOGIN_ATTEMPTS);
  await releaseAttempt(User, { _id: c._id }, LOGIN_ATTEMPTS);
  await releaseAttempt(User, { _id: c._id }, LOGIN_ATTEMPTS);
  check("release returns the slot and never goes below 0", (await state(c._id))?.failedLoginCount === 0);

  // 1d. The PIN uses the same helper on Family.
  const fam = await Family.create({ ownerUserId: c._id, familyName: `Race${tag}`, parentPinHash: await hashSecret("8158"), consent: { version: "test", acceptedAt: new Date() } });
  const pinGranted = (await Promise.all(Array.from({ length: 40 }, () => reserveAttempt(Family, { _id: fam._id, ownerUserId: c._id }, PIN_ATTEMPTS)))).filter(Boolean).length;
  check("40 simultaneous PIN guesses: exactly PIN_ATTEMPTS.max get through", pinGranted === PIN_ATTEMPTS.max, `granted ${pinGranted}`);
  await Family.deleteOne({ _id: fam._id });

  // 2. Real sign-in over HTTP: burst of wrong passwords, then the right one.
  const d = await newParent("d");
  const before = readFileSync(logFile, "utf8").length;
  await Promise.all(Array.from({ length: 30 }, () => signIn(base, d.email, `wrong ${randomBytes(6).toString("hex")}`)));
  const right = await signIn(base, d.email, PW);
  check("after a burst of 30 parallel wrong passwords, the RIGHT one is refused (locked)", right === null);
  await new Promise((r) => setTimeout(r, 1500)); // let the dev server flush its log
  const log = readFileSync(logFile, "utf8").slice(before);
  const verified = (log.match(/sign-in refused \(family\): bad_password/g) ?? []).length;
  check("the server checked at most 5 passwords from the burst", verified > 0 && verified <= 5, `checked ${verified}`);
  const s3 = await state(d._id);
  check("the account is locked", !!s3?.lockedUntil && s3.lockedUntil > new Date());

  // 3a. Pending parent resets the password → active AND consent email-verified stamp (COPPA record).
  const e = await newParent("e");
  await User.updateOne({ _id: e._id }, { $set: { status: "pending" } });
  const famE = await Family.create({ ownerUserId: e._id, familyName: `RaceE${tag}`, consent: { version: "test", acceptedAt: new Date() } });
  const tokE = await createActionToken("reset_password", { email: e.email, userId: e._id });
  await submitForm(base, `/reset-password?token=${tokE.raw}`, { password: `new race pass ${tag}` });
  const famAfter = await Family.findById(famE._id).lean();
  check("pending parent reset → active, with the consent email-verified stamp", (await User.findById(e._id).lean())?.status === "active" && !!famAfter?.consent?.emailVerifiedAt);
  await Family.deleteOne({ _id: famE._id });

  // 3b. Admin locked by wrong authenticator codes: a reset must not lift the lock.
  const adm = await createMfaAdmin(`e2e-race-adm-${tag}@spiritofsanta.test`);
  made.push(adm.id);
  const lockEnd = new Date(Date.now() + 24 * 3_600_000);
  await User.updateOne({ _id: adm.id }, { $set: { lockedUntil: lockEnd } });
  const hashOf = async (id: unknown) => (await User.findById(id).select("+passwordHash").lean())?.passwordHash;
  const hashBefore = await hashOf(adm.id);
  const tokA = await createActionToken("reset_password", { email: adm.email, userId: adm.id });
  await submitForm(adminBase, `/reset-password?token=${tokA.raw}`, { password: `new admin pass ${tag}` });
  const admAfter = await state(adm.id);
  check("MFA admin reset: password changed but the 24 h code lock stays", admAfter?.lockedUntil?.getTime() === lockEnd.getTime() && (await hashOf(adm.id)) !== hashBefore);

  // 3c. A SHORT password lockout (wrong passwords) IS lifted by a reset, even with two-step sign-in on.
  const adm2 = await createMfaAdmin(`e2e-race-adm2-${tag}@spiritofsanta.test`);
  made.push(adm2.id);
  await User.updateOne({ _id: adm2.id }, { $set: { lockedUntil: new Date(Date.now() + 10 * 60_000) } });
  const tokB = await createActionToken("reset_password", { email: adm2.email, userId: adm2.id });
  await submitForm(adminBase, `/reset-password?token=${tokB.raw}`, { password: `new admin2 pass ${tag}` });
  check("MFA admin reset lifts a short (wrong-password) lockout", !(await state(adm2.id))?.lockedUntil);
} finally {
  await User.deleteMany({ _id: trusted({ $in: made }) });
  await mongoose.disconnect();
}
process.exitCode = report();
