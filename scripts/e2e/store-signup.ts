/**
 * E2E: store sign-up, EMAIL FIRST (owner 2026-11-19): email → "Register your store" link → full form → active owner
 * + pending store. Plus: nothing created at step 1, 14-day purge, single-use link, existing accounts, honeypot,
 * replacing an old never-confirmed sign-up, forgot/reset password, rate limiting and Spanish. Runs against the store
 * app in DEV mode (emails are printed to the server log instead of sent; we read links from there).
 *
 *   1. npm run dev   (or: npx turbo run dev --filter=store), logging to a file
 *   2. node --conditions=react-server --env-file=apps/store/.env.local \
 *        scripts/e2e/store-signup.ts http://localhost:3001 <path-to-dev-server-log>
 *
 * Forms are submitted exactly like a browser WITHOUT JavaScript: we read the hidden
 * Server Action fields React renders into each form and POST the form. So this also proves
 * the forms work before JS loads. Only touches *_dev databases; cleans up after itself.
 */
import { STORE_AGREEMENT_VERSION } from "@repo/lib/store";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ActionToken, connectDb, RateLimit, Store, trusted, User } from "@repo/db";
import { hashSecret } from "@repo/auth/password";
import { shown, signIn as signInLib, submitForm as submitFormLib } from "./lib.ts";

const [base, logFile] = process.argv.slice(2);
if (!base || !logFile) throw new Error("usage: store-signup.ts <baseUrl> <devServerLog>");
const results: string[] = [];
const check = (n: string, ok: boolean, x = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`);
const tag = randomBytes(4).toString("hex");
const email = `e2e-store-${tag}@spiritofsanta.test`;
const PASSWORD = `e2e pass ${randomBytes(6).toString("hex")}`;
const NEW_PASSWORD = `e2e new ${randomBytes(6).toString("hex")}`;
const DAY = 86_400_000;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const clearLimits = () => RateLimit.collection.deleteMany({ key: { $regex: /^(register|resend|reset|signup-complete):/ } });
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

const details = {
  ownerName: "E2E Owner", password: PASSWORD, storeName: `E2E Toy Shop ${tag}`, category: "toys",
  description: "", phone: "", website: "", line1: "1 Test St", city: "Storm Lake", state: "IA", zip: "50588",
  agree: "on", locale: "en",
};
/** Step 1, then the emailed link's path (/register?token=…). */
async function requestLink(addr: string, lang: "en" | "es" = "en") {
  const page = await submitForm(lang === "es" ? "/es/register" : "/register", { email: addr, locale: lang });
  const link = await emailLink(addr, "storeSignupLink", lang === "es" ? "/es/register" : "/register");
  return { page, path: link ? link.replace(base, "") : null };
}

try {
  // 1. Step 1: a bad address is refused; a good one gets "check your email" and NOTHING is created.
  const badEmail = await submitForm("/register", { email: "not-an-email", locale: "en" });
  check("step 1: invalid email → field error", shown(badEmail, "valid email") || badEmail.includes("aria-invalid"));
  const { page: sent, path } = await requestLink(email);
  check("step 1 → 'Check your email'", shown(sent, "Check your email"));
  check("step 1 creates NO account and NO store", !(await User.exists({ email })) && !(await Store.exists({ "contact.email": email })));
  const tok = await ActionToken.findOne({ email, purpose: "store_signup" }).lean();
  const purgeIn = tok?.purgeAt ? tok.purgeAt.getTime() - Date.now() : 0;
  check("the request (and its address) is set to be DELETED in 14 days", purgeIn > 13.9 * DAY && purgeIn <= 14 * DAY);
  check("'Register your store' email with a /register link", !!path);

  // 2. The link opens the full form, with the email shown (not a field).
  const formPage = await (await fetch(base + path!)).text();
  check("the link opens the form, showing which email signs up", formPage.includes(`Signing up as ${email}`) && !formPage.includes('name="email"'));

  // 3. Step 2 validation (no JS): errors shown, typed values kept, password not echoed, nothing created.
  const bad = await submitForm(path!, { ...details, zip: "123", website: "http://x.example" });
  check("step 2: bad ZIP + non-https website → errors, nothing created", shown(bad, "Please fix the highlighted fields") && !(await User.exists({ email })));
  check("typed values kept after an error; password and token never echoed", bad.includes(`value="E2E Toy Shop ${tag}"`) && !bad.includes(PASSWORD));

  // 4. Step 2 success: ACTIVE owner (the click proved the email) + PENDING store with the agreement.
  const ok = await submitForm(path!, details);
  check("step 2 → 'Your store account is ready'", shown(ok, "Your store account is ready"));
  const user = await User.findOne({ email }).lean();
  const store = user?.storeId ? await Store.findById(user.storeId).lean() : null;
  check("owner created ACTIVE (no extra confirm step)", user?.status === "active" && user.role === "store_owner");
  check("store created PENDING (admin reviews) with the agreement recorded",
    store?.status === "pending" && store.ownerUserId?.toString() === user?._id.toString() && store.discountAgreement?.version === STORE_AGREEMENT_VERSION && store.contact?.email === email);
  check("password stored only as an argon2id hash", ((await User.findOne({ email }).select("+passwordHash").lean())?.passwordHash ?? "").startsWith("$argon2id$"));
  const again = await (await fetch(base + path!)).text();
  check("the link works once: reopening it shows 'ready' (no form); still one account", again.includes("Your store account is ready") && !again.includes('name="password"') && (await User.countDocuments({ email })) === 1);
  const session = await signIn(email, PASSWORD);
  check("sign-in works right away; session has role + storeId", session?.role === "store_owner" && session.storeId === String(store?._id));

  // 5. Step 1 again with a registered email: same answer, an 'already have an account' email, no new link.
  await clearLimits();
  const dup = await submitForm("/register", { email, locale: "en" });
  await new Promise((r) => setTimeout(r, 500));
  check("registered email → same 'Check your email' (no enumeration) + 'account exists' email, no new link",
    shown(dup, "Check your email") && countEmails(email, "accountExists") >= 1 && (await ActionToken.countDocuments({ email, purpose: "store_signup", usedAt: null })) === 0);

  // 6. Honeypot: looks successful, creates nothing, sends nothing.
  const botEmail = `e2e-bot-${tag}@spiritofsanta.test`;
  const bot = await submitForm("/register", { email: botEmail, company_url: "http://spam.example", locale: "en" });
  check("honeypot filled → fake success, no link stored, no email",
    shown(bot, "Check your email") && !(await ActionToken.exists({ email: botEmail })) && countEmails(botEmail, "storeSignupLink") === 0);

  // 7. An OLD never-confirmed one-step sign-up with this email is replaced when the link is used.
  await clearLimits();
  const oldEmail = `e2e-store-${tag}-old@spiritofsanta.test`;
  const old = await User.create({ email: oldEmail, passwordHash: await hashSecret("old pass phrase long"), role: "store_owner", status: "pending" });
  const oldStore = await Store.create({ name: `Old ${tag}`, slug: `e2e-old-${tag}`, category: "toys", status: "pending", ownerUserId: old._id, contact: { email: oldEmail } });
  const oldLink = await requestLink(oldEmail);
  const replaced = await submitForm(oldLink.path!, { ...details, storeName: `New ${tag}` });
  const fresh = await User.findOne({ email: oldEmail }).lean();
  check("an old unconfirmed sign-up is replaced by the proven one",
    shown(replaced, "Your store account is ready") && fresh?.status === "active" && String(fresh._id) !== String(old._id) && !(await Store.exists({ _id: oldStore._id })));

  // 8. An expired link: friendly message + the email box again.
  await clearLimits();
  const expEmail = `e2e-store-${tag}-exp@spiritofsanta.test`;
  const exp = await requestLink(expEmail);
  await ActionToken.updateOne({ email: expEmail, purpose: "store_signup" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const expPage = await (await fetch(base + exp.path!)).text();
  check("expired link → 'expired or already used' + ask for a new one", expPage.includes("expired or was already used") && expPage.includes('name="email"'));

  // 9. Forgot / reset password (unchanged flow, still works for these accounts).
  const forgot = await submitForm("/forgot-password", { email, locale: "en" });
  check("forgot password → neutral 'if that email has an account' message", shown(forgot, "If that email has an account"));
  const resetLink = await emailLink(email, "resetPassword", "/reset-password");
  check("reset email has a /reset-password link", !!resetLink);
  const resetPath = resetLink!.replace(base, "");
  const svBefore = (await User.findOne({ email }).lean())?.sessionVersion ?? -1;
  const reset = await submitForm(resetPath, { password: NEW_PASSWORD });
  check("reset → password changed, other sessions signed out",
    shown(reset, "Your password has been changed") && ((await User.findOne({ email }).lean())?.sessionVersion ?? -1) === svBefore + 1);
  check("old password no longer works; new one does", (await signIn(email, PASSWORD)) === null && (await signIn(email, NEW_PASSWORD))?.role === "store_owner");

  // 10. Rate limits on step 1: per-email silent (at most 3 emails/hour), per-IP visible (6th refused).
  await clearLimits();
  const rlEmail = `e2e-store-${tag}-rl@spiritofsanta.test`;
  const sameEmail: boolean[] = [];
  for (let i = 0; i < 4; i++) sameEmail.push(shown(await submitForm("/register", { email: rlEmail, locale: "en" }), "Check your email"));
  await new Promise((r) => setTimeout(r, 500));
  const sentCount = countEmails(rlEmail, "storeSignupLink");
  check("per-email limit is silent: 4 tries all say 'Check your email', only 3 emails sent", sameEmail.every(Boolean) && sentCount === 3, `${JSON.stringify(sameEmail)} sent=${sentCount}`);
  const ipOutcomes: boolean[] = [];
  for (let i = 0; i < 2; i++) ipOutcomes.push(shown(await submitForm("/register", { email: `e2e-store-${tag}-ip${i}@spiritofsanta.test`, locale: "en" }), "Too many tries"));
  check("6th request from one IP within an hour → 'Too many tries'", JSON.stringify(ipOutcomes) === "[false,true]", JSON.stringify(ipOutcomes));

  // 11. Spanish: page, email link and finished sign-up in Spanish.
  await clearLimits();
  const esEmail = `e2e-es-${tag}@spiritofsanta.test`;
  const es = await requestLink(esEmail, "es");
  check("Spanish step 1 works", shown(es.page, "Revisa tu correo"));
  check("Spanish user gets a Spanish /es/register link", !!es.path?.startsWith("/es/register"));
  const esDone = await submitForm(es.path!, { ...details, storeName: `Juguetería ${tag}`, locale: "es" });
  check("Spanish step 2 finishes", shown(esDone, "La cuenta de tu tienda está lista"));
} catch (err) {
  console.log(results.join("\n"));
  console.error("CRASHED after the checks above:", err);
  throw err;
} finally {
  const users = await User.find({ email: trusted({ $regex: new RegExp(`^e2e-(store|es|bot)-${tag}(-[a-z0-9]+)?@`) }) }).select("_id storeId email").lean();
  await Store.collection.deleteMany({ $or: [{ _id: { $in: users.map((u) => u.storeId).filter(Boolean) } }, { slug: `e2e-old-${tag}` }] });
  await ActionToken.collection.deleteMany({ email: { $regex: new RegExp(`-${tag}(-[a-z0-9]+)?@spiritofsanta\\.test$`) } });
  await User.collection.deleteMany({ _id: { $in: users.map((u) => u._id) } });
  await clearLimits();
  await mongoose.disconnect();
}
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
