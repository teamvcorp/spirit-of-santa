/**
 * News subscribers (owner 2026-11-12). SERVER-ONLY. Who may be on the Resend news list, and our proof of consent.
 *
 *   requestNews(email, "public", ctx)     public form: rate-limited, sends a "confirm" email (double opt-in)
 *   sendNewsConfirm(email, "donor", ...)  after a paid donation/tip whose payer ticked the box (no request IP)
 *   confirmNews(rawToken)                 the confirm link's button: records consent, adds them in Resend
 *   (parents: setNewsForParent, slice 2)
 *
 * Security / privacy rules:
 *  - DOUBLE OPT-IN: nothing reaches Resend until the address owner clicks the link, so nobody can sign up
 *    someone else. The link page only shows a button; the POST confirms (mail scanners pre-fetch links).
 *  - NO ENUMERATION: the form always answers "check your inbox", subscribed or not, and the per-email limit is
 *    SILENT (same pattern as sign-up, account-flows.ts checkLimits).
 *  - Adults only: the forms say "I'm 18 or older"; children never get an email field anywhere in the app.
 *  - The Resend call happens AFTER our record is saved. If Resend is down the row keeps syncedAt null and
 *    syncPendingNews() retries it (daily job), so a confirmed "yes" is never lost.
 */
import "server-only";
import { connectDb, NewsSubscription, type NewsSource } from "@repo/db";
import { sendEmail } from "@repo/email";
import { subscribeContact, unsubscribeContact } from "@repo/email/contacts";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@repo/lib/locales";
import { NEWS_CONSENT_VERSION } from "@repo/lib/news";
import { clientIp, emailKey, hitRateLimit, ipKey } from "./rate-limit.ts";
import { consumeActionToken, createActionToken } from "./tokens.ts";

const HOUR = 3600;
/** Sources that need the confirm email (parents prove their address when they confirm their account). */
export type ConfirmSource = Exclude<NewsSource, "parent">;

export type NewsRequestResult = { ok: true } | { ok: false; error: "rateLimited" };

/**
 * Send the confirm email, unless this address is already subscribed (then nothing: same answer to the caller)
 * or has asked too often (silent per-email limit: a stranger can't flood someone's inbox with confirm emails).
 */
export async function sendNewsConfirm(email: string, source: ConfirmSource, locale: Locale, appOrigin: string): Promise<void> {
  await connectDb();
  if (!(await hitRateLimit(`news:email:${emailKey(email)}`, 3, 24 * HOUR))) return;
  const existing = await NewsSubscription.findOne({ email, status: "subscribed" }).select("_id").lean();
  if (existing) return;
  const { raw } = await createActionToken("news_confirm", { email, newsSource: source, locale });
  const url = new URL(localizePath("/news/confirm", locale), appOrigin);
  url.searchParams.set("token", raw);
  try {
    await sendEmail({ to: email, locale, template: "newsConfirm", values: { link: url.toString() } });
  } catch (err) {
    // name only: no address/link in logs. They can simply ask again.
    console.error("[news] confirm email failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** Public form ("Get news"): visible per-IP + site-wide limits, then sendNewsConfirm. Honeypot → fake success. */
export async function requestNews(
  email: string,
  ctx: { headers: Headers; locale: Locale; appOrigin: string },
  honeypot?: string,
): Promise<NewsRequestResult> {
  await connectDb();
  const ip = ipKey(clientIp(ctx.headers));
  if (!(await hitRateLimit(`news:ip:${ip}`, 10, HOUR))) return { ok: false, error: "rateLimited" };
  if (!(await hitRateLimit("news:global", 500, HOUR))) return { ok: false, error: "rateLimited" };
  if (honeypot) return { ok: true }; // a bot filled the hidden field: pretend, do nothing
  await sendNewsConfirm(email, "public", ctx.locale, ctx.appOrigin);
  return { ok: true };
}

/**
 * The confirm button. Uses the single-use link, saves the consent record, then tells Resend.
 * Returns false for a bad/used/expired link.
 */
export async function confirmNews(raw: unknown): Promise<boolean> {
  await connectDb();
  const token = await consumeActionToken(raw, "news_confirm");
  if (!token?.newsSource) return false;
  const now = new Date();
  const locale = isLocale(token.locale) ? token.locale : DEFAULT_LOCALE;
  await NewsSubscription.updateOne(
    { email: token.email },
    {
      $set: {
        status: "subscribed",
        locale,
        consentVersion: NEWS_CONSENT_VERSION,
        consentAt: token.createdAt ?? now, // when they asked (the link was made at that moment)
        confirmedAt: now,
        syncedAt: null,
      },
      $unset: { unsubscribedAt: "" },
      $setOnInsert: { source: token.newsSource }, // where they FIRST said yes stays the source
    },
    { upsert: true, runValidators: true },
  );
  await syncOne(token.email);
  return true;
}

/**
 * Push one row's CURRENT status to Resend and stamp syncedAt. Best-effort: on failure the row stays unsynced
 * for syncPendingNews. The stamp only applies if the row didn't change meanwhile (status in the filter).
 */
async function syncOne(email: string): Promise<boolean> {
  const row = await NewsSubscription.findOne({ email }).select("status").lean();
  if (!row) return true;
  try {
    if (row.status === "subscribed") await subscribeContact(email);
    else await unsubscribeContact(email);
    await NewsSubscription.updateOne({ email, status: row.status }, { $set: { syncedAt: new Date() } });
    return true;
  } catch (err) {
    console.error("[news] Resend sync failed:", err instanceof Error ? err.message : "unknown");
    return false;
  }
}

/** Daily job: retry rows Resend hasn't accepted yet (oldest first, a few at a time: Resend allows 10 req/s). */
export async function syncPendingNews(limit = 50): Promise<{ synced: number; failed: number }> {
  await connectDb();
  const rows = await NewsSubscription.find({ syncedAt: null }).sort({ updatedAt: 1 }).limit(limit).select("email").lean();
  let synced = 0;
  let failed = 0;
  for (const r of rows) {
    if (await syncOne(r.email)) synced++;
    else failed++;
    // One sync = up to 3 Resend calls; Resend allows 10 per second (a burst got 429 in the live check 2026-11-12).
    await new Promise((res) => setTimeout(res, 400));
  }
  return { synced, failed };
}

