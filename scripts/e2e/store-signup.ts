/**
 * E2E: store sign-up → confirm email → sign in, plus forgot/reset password, duplicate
 * sign-up, honeypot, validation echo and rate limiting. Runs against the store app in DEV
 * mode (emails are printed to the server log instead of sent; we read links from there).
 *
 *   1. npm run dev   (or: npx turbo run dev --filter=store), logging to a file
 *   2. node --conditions=react-server --env-file=apps/store/.env.local \
 *        scripts/e2e/store-signup.ts http://localhost:3001 <path-to-dev-server-log>
 *
 * Forms are submitted exactly like a browser WITHOUT JavaScript: we read the hidden
 * Server Action fields React renders into each form and POST the form. So this also proves
 * the forms work before JS loads. Only touches *_dev databases; cleans up after itself.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ActionToken, connectDb, RateLimit, Store, trusted, User } from "@repo/db";
import { shown, signIn as signInLib, submitForm as submitFormLib } from "./lib.ts";

const [base, logFile] = process.argv.slice(2);
if (!base || !logFile) throw new Error("usage: store-signup.ts <baseUrl> <devServerLog>");
const results: string[] = [];
const check = (n: string, ok: boolean, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`);
const tag = randomBytes(4).toString("hex");
const email = `e2e-store-${tag}@spiritofsanta.test`;
const PASSWORD = `e2e pass ${randomBytes(6).toString("hex")}`;
const NEW_PASSWORD = `e2e new ${randomBytes(6).toString("hex")}`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const clearLimits = () => RateLimit.collection.deleteMany({ key: { $regex: /^(register|resend|reset):/ } });
await clearLimits();

/** No-JS form submit (shared helper), returning just the HTML. */
const submitForm = async (path: string, fields: Record<string, string>) => (await submitFormLib(base, path, fields)).html;

/** Newest dev-printed email for `to` with `template`, returns its link. */
async function emailLink(to: string, template: string, pathPart: string): Promise<string | null> {
  for (let i = 0; i < 20; i++) {
    const log = readFileSync(logFile, "utf8");
    const blocks = log.split("[email:dev] to=").filter((b) => b.startsWith(`${to} template=${template}`));
    const last = blocks.at(-1);
    const link = last ? new RegExp(`https?://[^\\s]+${pathPart}\\?token=[A-Za-z0-9_-]+`).exec(last)?.[0] : null;
    if (link) return link;
    await new Promise((r) => setTimeout(r, 500)); // emails are sent in after(): give it a moment
  }
  return null;
}
const countEmails = (to: string, template: string) =>
  readFileSync(logFile, "utf8").split("[email:dev] to=").filter((b) => b.startsWith(`${to} template=${template}`)).length;

const signIn = (addr: string, pw: string) => signInLib(base, addr, pw);

const form = {
  ownerName: "E2E Owner", email, password: PASSWORD, storeName: `E2E Toy Shop ${tag}`, category: "toys",
  description: "", phone: "", website: "", line1: "1 Test St", city: "Storm Lake", state: "IA", zip: "50588",
  agree: "on", locale: "en",
};

try {
  // 1. Validation errors come back in the page (no JS), typed values kept, password not echoed.
  const bad = await submitForm("/register", { ...form, zip: "123", website: "http://x.example" });
  check("bad ZIP + non-https website → errors shown, nothing created",
    shown(bad, "Please fix the highlighted fields") && !(await User.exists({ email })), "");
  check("typed values are kept after an error; password is not echoed back",
    bad.includes(`value="E2E Toy Shop ${tag}"`) && !bad.includes(PASSWORD));

  // 2. Successful sign-up.
  const ok = await submitForm("/register", form);
  check("sign-up → 'Check your email'", shown(ok, "Check your email"));
  const user = await User.findOne({ email }).lean();
  const store = user?.storeId ? await Store.findById(user.storeId).lean() : null;
  check("user created as pending store_owner", user?.status === "pending" && user.role === "store_owner");
  check("store created as pending with agreement recorded",
    store?.status === "pending" && store.ownerUserId?.toString() === user?._id.toString() && !!store?.discountAgreement?.acceptedAt && store.discountAgreement.version === "2026-11-05",
    store?.slug ?? "");
  check("password stored only as an argon2id hash",
    ((await User.findOne({ email }).select("+passwordHash").lean())?.passwordHash ?? "").startsWith("$argon2id$"));

  // 3. Can't sign in before confirming the email.
  check("sign-in refused while email unconfirmed", (await signIn(email, PASSWORD)) === null);

  // 4. Confirm email via the emailed link (button POST, not GET).
  const verifyLink = await emailLink(email, "verifyEmail", "/verify");
  check("verification email 'sent' with a /verify link", !!verifyLink);
  const verifyPath = verifyLink!.replace(base, "");
  await fetch(base + verifyPath); // a plain GET (like an email scanner) must NOT confirm
  check("opening the link (GET) alone doesn't confirm", (await User.findOne({ email }).lean())?.status === "pending");
  const confirmed = await submitForm(verifyPath, {});
  check("pressing Confirm → email confirmed", shown(confirmed, "Your email is confirmed") && (await User.findOne({ email }).lean())?.status === "active");
  const again = await submitForm(verifyPath, {});
  check("the same link can't be used twice", shown(again, "expired or was already used"));

  const session = await signIn(email, PASSWORD);
  check("sign-in works after confirming; session has role + storeId", session?.role === "store_owner" && session.storeId === String(store?._id));

  // 5. Signing up again with the same email: same answer, no new account, 'already have an account' email.
  const dup = await submitForm("/register", { ...form, storeName: "Another shop" });
  check("duplicate sign-up → same 'Check your email' answer (no enumeration)", shown(dup, "Check your email") && (await User.countDocuments({ email })) === 1);
  check("…and the owner gets an 'account exists' email instead", !!(await emailLink(email, "accountExists", "/signin").catch(() => null)) || countEmails(email, "accountExists") >= 1);

  // 6. Honeypot: looks successful, creates nothing, sends nothing.
  const botEmail = `e2e-bot-${tag}@spiritofsanta.test`;
  const bot = await submitForm("/register", { ...form, email: botEmail, company_url: "http://spam.example" });
  check("honeypot filled → bot sees fake success, but no account and no email",
    shown(bot, "Check your email") && !(await User.exists({ email: botEmail })) && countEmails(botEmail, "verifyEmail") === 0);

  // 7. Forgot / reset password.
  const forgot = await submitForm("/forgot-password", { email, locale: "en" });
  check("forgot password → neutral 'if that email has an account' message", shown(forgot, "If that email has an account"));
  const unknown = await submitForm("/forgot-password", { email: `nobody-${tag}@spiritofsanta.test`, locale: "en" });
  check("unknown email → identical message", shown(unknown, "If that email has an account"));
  const resetLink = await emailLink(email, "resetPassword", "/reset-password");
  check("reset email has a /reset-password link", !!resetLink);
  const resetPath = resetLink!.replace(base, "");
  const svBefore = (await User.findOne({ email }).lean())?.sessionVersion ?? -1;
  const reset = await submitForm(resetPath, { password: NEW_PASSWORD });
  check("reset → password changed, other sessions signed out",
    shown(reset, "Your password has been changed") && ((await User.findOne({ email }).lean())?.sessionVersion ?? -1) === svBefore + 1);
  check("old password no longer works; new one does", (await signIn(email, PASSWORD)) === null && (await signIn(email, NEW_PASSWORD))?.role === "store_owner");
  const reuse = await submitForm(resetPath, { password: "another new password" });
  check("reset link can't be reused", shown(reuse, "expired or was already used"));
  const tooShort = await submitForm("/reset-password?token=x", { password: "short" });
  check("short new password rejected", tooShort.includes(">Too short.</p>"));

  // 8. Rate limit: more than 3 sign-ups for one email in an hour are refused.
  await clearLimits();
  // Per-EMAIL limit is silent (review fix): same answer every time, but at most 3 emails/hour.
  const existsBefore = countEmails(email, "accountExists");
  const sameEmail: boolean[] = [];
  for (let i = 0; i < 4; i++) sameEmail.push(shown(await submitForm("/register", form), "Check your email"));
  await new Promise((r) => setTimeout(r, 500));
  const sent = countEmails(email, "accountExists") - existsBefore;
  check("per-email limit is silent: 4 tries all say 'Check your email', only 3 emails sent",
    sameEmail.every(Boolean) && sent === 3, `${JSON.stringify(sameEmail)} sent=${sent}`);
  // Per-IP limit is visible: the 6th sign-up from one address in an hour is refused.
  const ipOutcomes: boolean[] = [];
  for (let i = 0; i < 2; i++) {
    ipOutcomes.push(shown(await submitForm("/register", { ...form, email: `e2e-store-${tag}-ip${i}@spiritofsanta.test`, storeName: `IP shop ${i} ${tag}` }), "Too many tries"));
  }
  check("6th sign-up from one IP within an hour → 'Too many tries'", JSON.stringify(ipOutcomes) === "[false,true]", JSON.stringify(ipOutcomes));

  // 9. Spanish: page and emails in Spanish.
  await clearLimits();
  const esEmail = `e2e-es-${tag}@spiritofsanta.test`;
  const es = await submitForm("/es/register", { ...form, email: esEmail, storeName: `Juguetería ${tag}`, locale: "es" });
  check("Spanish sign-up page works", shown(es, "Revisa tu correo"));
  const esLink = await emailLink(esEmail, "verifyEmail", "/es/verify");
  check("Spanish user gets a Spanish /es/verify link", !!esLink);
} catch (err) {
  console.log(results.join("\n"));
  console.error("CRASHED after the checks above:", err);
  throw err;
} finally {
  const users = await User.find({ email: trusted({ $regex: new RegExp(`^e2e-(store|es|bot)-${tag}(-ip\\d)?@`) }) }).select("_id storeId email").lean();
  await Store.collection.deleteMany({ _id: { $in: users.map((u) => u.storeId).filter(Boolean) } });
  await ActionToken.collection.deleteMany({ email: { $regex: new RegExp(`-${tag}(-ip\\d)?@spiritofsanta\\.test$`) } });
  await User.collection.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  await clearLimits();
  await mongoose.disconnect();
}
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
