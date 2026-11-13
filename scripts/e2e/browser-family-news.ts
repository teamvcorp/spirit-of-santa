/**
 * E2E for NEWS sign-up (owner 2026-11-12): public form on the home page → confirm link → NewsSubscription + Resend.
 *
 *   family dev server on :3000 (dev PRINTS emails and Resend contact calls instead of sending: "[contacts:dev]"),
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/browser-family-news.ts http://localhost:3000
 *
 * The confirm link is made here with createActionToken (the same kind of single-use token the email carries),
 * because the real one is only in the printed email. *_dev database only; removes everything it creates.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { ActionToken, connectDb, NewsSubscription, RateLimit, trusted } from "@repo/db";
import { createActionToken } from "@repo/auth/tokens";
import { syncPendingNews } from "@repo/auth/news";
import { PRIVACY_VERSION } from "@repo/lib/family";
import { NEWS_CONSENT_VERSION } from "@repo/lib/news";
import { makeChecks } from "./lib.ts";

const [base] = process.argv.slice(2);
if (!base) throw new Error("usage: browser-family-news.ts <familyUrl>");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const email = `news-${tag}@spiritofsanta.test`;
const otherMail = `news2-${tag}@spiritofsanta.test`;
const botMail = `newsbot-${tag}@spiritofsanta.test`;

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
async function newPage() {
  const p = await (await browser.newContext()).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const ready = (p: Page, sel: string) =>
  p.waitForFunction((s) => {
    const b = document.querySelector(`${s} button[type=submit]`) as HTMLButtonElement | null;
    return !!b && !b.disabled;
  }, sel, { timeout: 60_000 });
const tokens = (mail: string) => ActionToken.countDocuments({ email: mail, purpose: "news_confirm" });

async function signup(p: Page, mail: string, opts: { adult?: boolean; honeypot?: boolean; path?: string } = {}) {
  await p.goto(`${base}${opts.path ?? "/"}#news`);
  await ready(p, '[data-testid="news-form"]');
  const form = p.locator('[data-testid="news-form"]');
  await form.locator('[name="email"]').fill(mail);
  if (opts.adult !== false) await form.locator('[name="adult"]').check();
  else await p.evaluate(() => document.querySelector('[name="adult"]')?.removeAttribute("required")); // test the SERVER check
  if (opts.honeypot) await p.evaluate(() => ((document.querySelector('[name="company_url"]') as HTMLInputElement).value = "http://spam.example"));
  await form.locator("button[type=submit]").click();
}
const sentShown = (p: Page) => p.locator("#news [role=status]").first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false);

try {
  const page = await newPage();

  // 1. Privacy page has the news section and the new version.
  await page.goto(`${base}/privacy`);
  await page.locator("main h1").waitFor({ timeout: 60_000 });
  const privacy = await page.locator("main").innerText();
  check("privacy: 'News emails' section + new version", privacy.includes("News emails") && privacy.includes(PRIVACY_VERSION));

  // 2. Box not ticked → refused by the SERVER, typed email kept, nothing sent.
  await signup(page, email, { adult: false });
  await page.locator("#news [role=alert]").first().waitFor({ timeout: 20_000 });
  check("no 18+/opt-in tick → refused, email kept, no link made",
    (await page.locator('#news [name="email"]').inputValue()) === email && (await tokens(email)) === 0);

  // 3. Valid → "check your inbox", a confirm link exists (public, English), still NOT subscribed.
  await signup(page, email);
  check("valid sign-up → 'check your inbox'", await sentShown(page));
  const tok = await ActionToken.findOne({ email, purpose: "news_confirm" }).lean();
  check("confirm link made: source public, language en, ~7 days", tok?.newsSource === "public" && tok.locale === "en" && !!tok.expiresAt && tok.expiresAt.getTime() - Date.now() > 6.9 * 864e5);
  check("not subscribed before the click (double opt-in)", !(await NewsSubscription.exists({ email })));

  // 4. Honeypot → same answer, nothing made.
  const bot = await newPage();
  await signup(bot, botMail, { honeypot: true });
  check("bot (honeypot) → same answer, no link", (await sentShown(bot)) && (await tokens(botMail)) === 0);

  // 5. Silent per-email limit: 3 links a day per address, the 4th+ still says "check your inbox".
  for (let i = 0; i < 3; i++) {
    const p = await newPage();
    await signup(p, otherMail);
    await sentShown(p);
    await p.close();
  }
  const extra = await newPage();
  await signup(extra, otherMail);
  check("4th request for one address: same answer, no 4th link (silent limit)",
    (await sentShown(extra)) && (await tokens(otherMail)) === 3);
  // Older links are CANCELLED (marked used, row kept) when a new one is made: only the newest one works.
  check("only the newest link for an address still works",
    (await ActionToken.countDocuments({ email: otherMail, purpose: "news_confirm", usedAt: trusted({ $eq: null }) })) === 1);

  // 6. Opening the link does nothing; pressing the button confirms.
  const { raw } = await createActionToken("news_confirm", { email, newsSource: "public", locale: "en" });
  const c = await newPage();
  await c.goto(`${base}/news/confirm?token=${raw}`);
  await ready(c, "main");
  check("opening the confirm link alone subscribes nobody", !(await NewsSubscription.exists({ email })));
  await c.locator("main button[type=submit]").click();
  await c.locator("main [role=status]").first().waitFor({ timeout: 20_000 });
  const row = await NewsSubscription.findOne({ email }).lean();
  check("confirmed: subscribed, source public, consent version + times, synced (dev prints the Resend call)",
    row?.status === "subscribed" && row.source === "public" && row.consentVersion === NEWS_CONSENT_VERSION && !!row.consentAt && !!row.confirmedAt && !!row.syncedAt);

  // 7. Same link again → "used or expired".
  const c2 = await newPage();
  await c2.goto(`${base}/news/confirm?token=${raw}`);
  await ready(c2, "main");
  await c2.locator("main button[type=submit]").click();
  await c2.locator("main [role=alert]").first().waitFor({ timeout: 20_000 });
  check("a used link is refused", true);

  // 8. Already subscribed → same answer, no new link.
  await RateLimit.deleteMany({ key: trusted({ $regex: "^news:" }) }); // fresh limits for the rest
  const before = await tokens(email);
  const again = await newPage();
  await signup(again, email);
  check("already subscribed: same answer, no new link", (await sentShown(again)) && (await tokens(email)) === before);

  // 9. Retry job: an unsynced row gets synced.
  await NewsSubscription.updateOne({ email }, { $set: { syncedAt: null } });
  const r = await syncPendingNews();
  check("retry job syncs a row Resend hadn't accepted", r.synced >= 1 && !!(await NewsSubscription.findOne({ email }).lean())?.syncedAt);

  // 10. Spanish.
  const es = await newPage();
  await es.goto(`${base}/es#news`);
  await es.locator("#news h2").filter({ hasText: "Recibe noticias" }).waitFor({ timeout: 30_000 });
  check("Spanish home shows the news form", true);
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const mails = [email, otherMail, botMail];
  await ActionToken.deleteMany({ email: trusted({ $in: mails }) });
  await NewsSubscription.deleteMany({ email: trusted({ $in: mails }) });
  await RateLimit.deleteMany({ key: trusted({ $regex: "^news:" }) });
  await mongoose.disconnect();
}
process.exit(report());
