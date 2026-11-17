/**
 * News subscribers (owner 2026-11-12). SERVER-ONLY. Who may be on the Resend news list, and our proof of consent.
 *
 *   requestNews(email, "public", ctx)     public form: rate-limited, sends a "confirm" email (double opt-in)
 *   sendNewsConfirm(email, "donor", ...)  after a paid donation/tip whose payer ticked the box (no request IP)
 *   confirmNews(rawToken)                 the confirm link's button: records consent, adds them in Resend
 *   applySignupNewsOptIn(userId)          parent ticked "news" at sign-up: applied once the email is confirmed
 *   setParentNews(userId, on) / parentNewsOn(userId)   the parent's email settings switch (PIN page)
 *   markNewsForDeletion + forgetNews      account deletion: our row AND the Resend contact go
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
import { ActionToken, connectDb, NewsSubscription, trusted, User, type DbSession, type NewsSource } from "@repo/db";
import { sendEmail } from "@repo/email";
import { removeContact, subscribeContact, unsubscribeContact } from "@repo/email/contacts";
import { localizePath } from "@repo/i18n/paths";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@repo/lib/locales";
import { NEWS_CONSENT_VERSION, NEWS_MAX_SYNC_ATTEMPTS } from "@repo/lib/news";
import { clientIp, emailKey, hitRateLimit, ipKey } from "./rate-limit.ts";
import { consumeActionToken, createActionToken } from "./tokens.ts";

const HOUR = 3600;
/** Sources that need the confirm email (parents prove their address when they confirm their account). */
export type ConfirmSource = Exclude<NewsSource, "parent">;

export type NewsRequestResult = { ok: true } | { ok: false; error: "rateLimited" };

/**
 * Send the confirm email, unless this address asked too often (silent per-email limit: a stranger can't flood
 * someone's inbox). It is sent EVEN IF we think they're subscribed (review 2026-11-12): Resend's own unsubscribe
 * link changes only Resend, so our row may be stale, and skipping would lock that person out forever. Doing the
 * same work either way also means the response time says nothing about the address.
 */
export async function sendNewsConfirm(email: string, source: ConfirmSource, locale: Locale, appOrigin: string): Promise<void> {
  await connectDb();
  if (!(await hitRateLimit(`news:email:${emailKey(email)}`, 3, 24 * HOUR))) return;
  const { raw } = await createActionToken("news_confirm", { email, newsSource: source, locale, newsConsentVersion: NEWS_CONSENT_VERSION });
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
  try {
    await NewsSubscription.updateOne(
      { email: token.email },
      {
        $set: {
          status: "subscribed",
          locale,
          // The wording shown when they TICKED the box (stored on the link), not whatever is current at the click.
          consentVersion: token.newsConsentVersion ?? NEWS_CONSENT_VERSION,
          consentAt: token.createdAt ?? now, // when they asked (the link was made at that moment)
          confirmedAt: now,
          syncedAt: null,
          syncAttempts: 0,
        },
        $unset: { unsubscribedAt: "", forgetAt: "", syncAttemptAt: "" },
        $inc: { rev: 1 },
        $setOnInsert: { source: token.newsSource }, // where they FIRST said yes stays the source
      },
      { upsert: true, runValidators: true },
    );
  } catch (err) {
    // Saving failed (DB blip): give the link back so their "yes" isn't lost to a spent link, then report the error.
    await ActionToken.updateOne({ _id: token._id }, { $set: { usedAt: null } }).catch(() => {});
    throw err;
  }
  await syncOne(token.email);
  return true;
}


/**
 * Push one row's CURRENT status to Resend and stamp syncedAt. Best-effort: on failure the row stays unsynced (with
 * a try count) for syncPendingNews. Ordering (review 2026-11-12): the stamp only lands if `rev` is unchanged; if the
 * status changed during the call, we sync AGAIN with the new status, so the newest choice is always the last call.
 */
async function syncOne(email: string): Promise<boolean> {
  for (let pass = 0; pass < 3; pass++) {
    const row = await NewsSubscription.findOne({ email }).select("status forgetAt rev").lean();
    if (!row) return true;
    try {
      if (row.forgetAt) await removeContact(email);
      else if (row.status === "subscribed") await subscribeContact(email);
      else await unsubscribeContact(email);
    } catch (err) {
      console.error("[news] Resend sync failed:", err instanceof Error ? err.message : "unknown");
      // syncedAt null WITHOUT a rev check: a timed-out call may still land at Resend after a newer one, so the
      // row must be re-pushed with its current status (review 2026-11-12).
      await NewsSubscription.updateOne({ email }, { $set: { syncedAt: null, syncAttemptAt: new Date() }, $inc: { syncAttempts: 1 } });
      return false;
    }
    if (row.forgetAt) {
      // Account deleted: the contact is gone, now our row (nothing kept about a deleted family).
      if ((await NewsSubscription.deleteOne({ email, rev: row.rev })).deletedCount === 1) return true;
      continue; // changed meanwhile (they signed up again?): sync the new state
    }
    const stamped = await NewsSubscription.updateOne(
      { email, rev: row.rev },
      { $set: { syncedAt: new Date(), syncAttempts: 0 }, $unset: { syncAttemptAt: "" } },
    );
    if (stamped.matchedCount === 1) return true;
    // rev changed while Resend was busy: loop and push the newer status.
  }
  // Still changing: our last call may have landed after a newer one, so force a re-push by the daily job.
  await NewsSubscription.updateOne({ email }, { $set: { syncedAt: null } });
  return false;
}

/**
 * Daily job: retry rows Resend hasn't accepted yet, least recently tried first (so a few bad rows can't block the
 * queue), a few at a time (Resend allows 10 req/s). Rows that failed NEWS_MAX_SYNC_ATTEMPTS times are skipped and
 * counted as `stuck`: the cron reports them every day until someone looks.
 */
export async function syncPendingNews(limit = 50): Promise<{ synced: number; failed: number; stuck: number }> {
  await connectDb();
  // $not $gte (not $lt): also matches rows that have no syncAttempts field yet.
  const retryable = { syncedAt: null, syncAttempts: trusted({ $not: { $gte: NEWS_MAX_SYNC_ATTEMPTS } }) };
  const rows = await NewsSubscription.find(retryable).sort({ syncAttemptAt: 1 }).limit(limit).select("email").lean();
  let synced = 0;
  let failed = 0;
  for (const r of rows) {
    if (await syncOne(r.email)) synced++;
    else failed++;
    // One sync = up to 3 Resend calls; Resend allows 10 per second (a burst got 429 in the live check 2026-11-12).
    await new Promise((res) => setTimeout(res, 400));
  }
  const stuck = await NewsSubscription.countDocuments({ syncedAt: null, syncAttempts: trusted({ $gte: NEWS_MAX_SYNC_ATTEMPTS }) });
  return { synced, failed, stuck };
}


// ── Parents (slice 2) ────────────────────────────────────────────────────────────────
/** An ACTIVE parent's proven email + language (null for anyone else). */
async function activeParent(userId: unknown) {
  const u = await User.findOne({ _id: userId, role: "parent", status: "active" }).select("email locale newsOptInAt").lean();
  return u ? { id: u._id, email: u.email, locale: isLocale(u.locale) ? u.locale : DEFAULT_LOCALE, newsOptInAt: u.newsOptInAt } : null;
}

/**
 * Subscribe/unsubscribe a parent by their (already proven) account email. No confirm email needed: confirming the
 * account proved the address. Saying "yes" again while already subscribed keeps the ORIGINAL consent record.
 * Concurrent first "yes" clicks: the unique email index makes one upsert fail (E11000) → retried as an update.
 */
async function writeParentNews(p: { id: unknown; email: string; locale: Locale }, on: boolean, consentAt: Date): Promise<void> {
  const now = new Date();
  if (!on) {
    await NewsSubscription.updateOne(
      { email: p.email, status: "subscribed" },
      { $set: { status: "unsubscribed", unsubscribedAt: now, syncedAt: null, userId: p.id }, $inc: { rev: 1 } },
    );
  } else {
    let existing = await NewsSubscription.findOne({ email: p.email }).select("status forgetAt").lean();
    if (existing?.forgetAt) {
      // THIS account is being deleted: never put it back on the list.
      if (!(await User.exists({ _id: p.id }))) return;
      // Leftover of an EARLIER, deleted account with the same email (Resend was down when it was deleted):
      // finish that deletion first, then subscribe this new account (review 2026-11-12).
      await syncOne(p.email);
      existing = await NewsSubscription.findOne({ email: p.email }).select("status forgetAt").lean();
      if (existing?.forgetAt) throw new Error("news: an earlier account's removal is still pending"); // caller keeps/retries
    }
    if (existing?.status === "subscribed") {
      await NewsSubscription.updateOne({ email: p.email }, { $set: { userId: p.id } });
      return; // already on the list (maybe from the public form): nothing to tell Resend
    }
    const update = {
      $set: { status: "subscribed", userId: p.id, locale: p.locale, consentVersion: NEWS_CONSENT_VERSION, consentAt, confirmedAt: now, syncedAt: null, syncAttempts: 0 },
      $unset: { unsubscribedAt: "", forgetAt: "", syncAttemptAt: "" },
      $inc: { rev: 1 },
      $setOnInsert: { source: "parent" },
    };
    // forgetAt: null in the filter: a deletion landing meanwhile makes the upsert collide (E11000) and the retry
    // match nothing, so a racing "on" can't put a deleted family back on the list (review 2026-11-12).
    const filter = { email: p.email, forgetAt: null };
    try {
      await NewsSubscription.updateOne(filter, update, { upsert: true, runValidators: true });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      await NewsSubscription.updateOne(filter, update, { runValidators: true }); // lost the insert race
    }
    // DELETED between our check and the write? Then take it straight back off the list. (Existence only: a
    // suspension is not a deletion and must not wipe the record.)
    if (!(await User.exists({ _id: p.id }))) {
      await NewsSubscription.updateOne(
        { email: p.email },
        { $set: { status: "unsubscribed", forgetAt: new Date(), syncedAt: null }, $unset: { userId: "" }, $inc: { rev: 1 } },
      );
    }
  }
  await syncOne(p.email);
}

/** After the account email is confirmed: apply a sign-up "send me news" tick, once. */
export async function applySignupNewsOptIn(userId: unknown): Promise<void> {
  const p = await activeParent(userId);
  if (!p?.newsOptInAt) return;
  // Clear the pending wish FIRST and only continue if THIS call cleared it (no double apply).
  const res = await User.updateOne({ _id: p.id, newsOptInAt: p.newsOptInAt }, { $unset: { newsOptInAt: "" } });
  if (res.modifiedCount !== 1) return;
  try {
    await writeParentNews(p, true, p.newsOptInAt);
  } catch (err) {
    // Put the wish back (only if nothing newer replaced it), so a DB blip doesn't silently drop it.
    await User.updateOne({ _id: p.id, newsOptInAt: null }, { $set: { newsOptInAt: p.newsOptInAt } }).catch(() => {});
    throw err;
  }
}

/** The settings switch. false = this user isn't an active parent. */
export async function setParentNews(userId: unknown, on: boolean): Promise<boolean> {
  await connectDb();
  const p = await activeParent(userId);
  if (!p) return false;
  // An explicit choice replaces any sign-up wish still pending (e.g. the account was activated by a password reset
  // and the old confirm link is clicked later): the NEWEST choice wins (review 2026-11-12).
  if (p.newsOptInAt) await User.updateOne({ _id: p.id }, { $unset: { newsOptInAt: "" } });
  await writeParentNews(p, on, new Date());
  return true;
}

/** Is this parent's email on the news list right now (as far as we know)? */
export async function parentNewsOn(userId: unknown): Promise<boolean> {
  await connectDb();
  const p = await activeParent(userId);
  if (!p) return false;
  return !!(await NewsSubscription.exists({ email: p.email, status: "subscribed" }));
}

/**
 * Account deletion, step 1, INSIDE the deletion transaction: mark the row forgetAt (+ unsubscribed), so the
 * "remove from the list" job is recorded atomically with the account going. Step 2 (forgetNews) does it now;
 * if Resend can't be reached the daily job finishes it. Nothing about a deleted family stays on the list.
 */
export async function markNewsForDeletion(email: string, session: DbSession): Promise<void> {
  await NewsSubscription.updateOne(
    { email },
    { $set: { status: "unsubscribed", forgetAt: new Date(), syncedAt: null, syncAttempts: 0 }, $unset: { userId: "", syncAttemptAt: "" }, $inc: { rev: 1 } },
    { session },
  );
}

/** Account deletion, step 2, AFTER the transaction: delete the Resend contact and our row (best-effort). */
export async function forgetNews(email: string): Promise<void> {
  await connectDb();
  if (!(await NewsSubscription.exists({ email, forgetAt: trusted({ $ne: null }) }))) return; // never on our list
  await syncOne(email);
}
