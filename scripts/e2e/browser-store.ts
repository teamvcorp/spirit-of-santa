/**
 * Real-browser E2E (Microsoft Edge via playwright-core; no browser download) against a
 * PRODUCTION build of the store app. Exercises the normal JavaScript path of the account
 * forms, which is what real users hit.
 *
 *   npx turbo run build --filter=store
 *   (from apps/store) node ../../node_modules/next/dist/bin/next start -p 3101
 *   node --conditions=react-server --env-file=apps/store/.env.local scripts/e2e/browser-store.ts http://localhost:3101
 *
 * Production SENDS real emails, so the one successful sign-up uses Resend's test inbox
 * (delivered+<tag>@resend.dev: accepted and discarded, no reputation impact). Everything
 * else uses paths that send nothing (validation errors, unknown email, bad tokens).
 * Only *_dev databases; cleans up after itself.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { ActionToken, connectDb, RateLimit, Store, User } from "@repo/db";
import { makeChecks } from "./lib.ts";

const base = process.argv[2];
if (!base) throw new Error("usage: browser-store.ts <baseUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const signupEmail = `delivered+sos${tag}@resend.dev`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const clearLimits = () => RateLimit.collection.deleteMany({ key: { $regex: /^(register|resend|reset):/ } });
await clearLimits();

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(e.message));

async function fillRegister(p: Page, overrides: Record<string, string> = {}) {
  const v = {
    ownerName: "Browser Owner", email: signupEmail, password: `browser pass ${tag}`, storeName: `Browser Toys ${tag}`,
    line1: "2 Test Ave", city: "Storm Lake", state: "IA", zip: "50588", ...overrides,
  };
  // State and category are drop-downs (select), the rest are text boxes.
  for (const [name, value] of Object.entries(v)) {
    if (name === "state") await p.selectOption('[name="state"]', value);
    else await p.fill(`[name="${name}"]`, value);
  }
  await p.selectOption('[name="category"]', "toys");
  await p.check('[name="agree"]');
}
// Scoped to <main>: Next.js adds its own role="alert" route announcer elsewhere on the page.
const alertText = async (p: Page) => (await p.locator('main [role="alert"], main [role="status"]').allInnerTexts()).join(" | ");

try {
  // 1. Validation error, JS path: message + field error shown, typed values kept.
  await page.goto(`${base}/register`);
  await page.waitForFunction(() => !(document.querySelector('button[type="submit"]') as HTMLButtonElement)?.disabled);
  check("submit button is enabled once the page is ready", true);
  await fillRegister(page, { zip: "123" });
  // Bypass the browser's own pattern check to prove the SERVER rejects it too.
  await page.$eval("form", (f) => f.setAttribute("novalidate", ""));
  await page.click('button[type="submit"]');
  await page.locator('main [role="alert"]').first().waitFor();
  check("server-side validation error shown", (await alertText(page)).includes("Please fix the highlighted fields"), await alertText(page));
  check("store name kept after the error", (await page.inputValue('[name="storeName"]')) === `Browser Toys ${tag}`);
  check("category and agreement tick kept after the error (form re-mounts with echoed values)",
    (await page.inputValue('[name="category"]')) === "toys" && (await page.isChecked('[name="agree"]')));
  check("password field is empty after the error (never echoed)", (await page.inputValue('[name="password"]')) === "");
  check("no account created for invalid input", !(await User.exists({ email: signupEmail })));

  // 2. Successful sign-up (real email to Resend's test inbox).
  await page.fill('[name="zip"]', "50588");
  await page.fill('[name="password"]', `browser pass ${tag}`); // password isn't echoed back after an error
  await page.click('button[type="submit"]');
  await page.locator('main [role="status"]').first().waitFor({ timeout: 20_000 });
  check("sign-up → 'Check your email' shown", (await alertText(page)).includes("Check your email"));
  const u = await User.findOne({ email: signupEmail }).lean();
  check("pending store owner + pending store created", u?.status === "pending" && !!(u?.storeId && (await Store.findById(u.storeId).lean())?.status === "pending"));

  // 3. Forgot password with an unknown email: neutral message.
  await page.goto(`${base}/forgot-password`);
  await page.fill('[name="email"]', `nobody-${tag}@spiritofsanta.test`);
  await page.click('button[type="submit"]');
  await page.locator('main [role="status"]').waitFor({ timeout: 20_000 });
  check("forgot password (unknown email) → neutral message", (await alertText(page)).includes("If that email has an account"));

  // 4. Bad links show the 'expired or already used' message.
  await page.goto(`${base}/reset-password?token=${"A".repeat(43)}`);
  await page.fill('[name="password"]', "a perfectly long password");
  await page.click('button[type="submit"]');
  await page.locator('main [role="alert"]').waitFor();
  check("reset with a bad token → 'expired or already used'", (await alertText(page)).includes("expired or was already used"));
  await page.goto(`${base}/verify?token=${"B".repeat(43)}`);
  await page.click('button[type="submit"]');
  await page.locator('main [role="alert"]').waitFor();
  check("confirm with a bad token → 'expired or already used'", (await alertText(page)).includes("expired or was already used"));

  // 5. Spanish page, Spanish messages.
  await page.goto(`${base}/es/register`);
  await page.waitForFunction(() => !(document.querySelector('button[type="submit"]') as HTMLButtonElement)?.disabled);
  await fillRegister(page, { email: `nadie-${tag}@spiritofsanta.test`, zip: "1" });
  await page.$eval("form", (f) => f.setAttribute("novalidate", ""));
  await page.click('button[type="submit"]');
  await page.locator('main [role="alert"]').first().waitFor();
  check("Spanish validation message", (await alertText(page)).includes("Corrige los campos marcados"));

  check("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const users = await User.find({ email: signupEmail }).select("_id storeId").lean();
  await Store.collection.deleteMany({ _id: { $in: users.map((x) => x.storeId).filter(Boolean) } });
  await User.collection.deleteMany({ _id: { $in: users.map((x) => x._id) } });
  await ActionToken.collection.deleteMany({ email: signupEmail });
  await clearLimits();
  await mongoose.disconnect();
}
process.exit(report());
