/**
 * Phase 7.2: the parent emails sent by the daily money job (family app /api/cron/money).
 * SERVER-ONLY. User decisions 2026-11-06: email only, parents only.
 *
 *  - Daily SUMMARY ("magic" + "deeds"): one email per family per day at most, listing per child the
 *    points received from OTHERS (tips + community donation shares; a parent's own bonus/pay-up is
 *    not news to them) and the good deeds thanked. Only news newer than notify.lastDigestAt, so
 *    nothing is reported twice; a failed send is simply retried the next day (7-day look-back).
 *  - Season REMINDERS ("reminders"): 3 days before the freeze date (lists freeze) and 3 days before
 *    the pay-up deadline (only families with an unfinished gift). Once per season each
 *    (notify.cutoffSentYear / payUpSentYear).
 * Everything goes through sendEmailBatch (100 per request) with unsubscribe links + headers.
 * Respects each family's settings; skips parents whose account isn't active.
 */
import "server-only";
import { Deed, Family, Kid, Transaction, trusted, User, WishListItem } from "@repo/db";
import { digestLines, sendEmailBatch, type EmailTemplateName, type SendEmailInput } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { formatPoints } from "@repo/lib/format";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@repo/lib/locales";
import { SEASON_TIME_ZONE, isoDay, calendarDateIn, startOfDayInZone } from "@repo/lib/season";
import { DAY_MS } from "@repo/lib/time";
import { getSeasonState } from "@repo/stores/season";
import { familyAppOrigin } from "@repo/stores/urls";
import { payUpWindow } from "@repo/wishlists/payup";
import { optOutLinksFor, prefsOf } from "./notifications.ts";

const LOOK_BACK_DAYS = 7;
/** Reminders go out this many days before the date they're about. */
export const REMINDER_DAYS_BEFORE = 3;
/** Points from OTHER people (a parent's own bonus or pay-up is not news to that parent). */
const NEWS_TYPES = ["earn_tip", "earn_donation"] as const;

type FamilyRow = { _id: unknown; ownerUserId: unknown; notify?: { magic?: boolean; deeds?: boolean; reminders?: boolean; lastDigestAt?: Date; cutoffSentYear?: number; payUpSentYear?: number } };
type Parent = { email: string; locale: Locale };

/** Active parent accounts by family (one query). */
async function parentsOf(families: FamilyRow[]): Promise<Map<string, Parent>> {
  const users = await User.find({ _id: trusted({ $in: families.map((f) => String(f.ownerUserId)) }), status: "active" })
    .select("email locale")
    .lean<{ _id: unknown; email: string; locale?: string }[]>();
  const byUser = new Map(users.map((u) => [String(u._id), { email: u.email, locale: isLocale(u.locale) ? u.locale : DEFAULT_LOCALE }]));
  const out = new Map<string, Parent>();
  for (const f of families) {
    const p = byUser.get(String(f.ownerUserId));
    if (p) out.set(String(f._id), p);
  }
  return out;
}

const familyLink = (locale: Locale, path: string) => `${familyAppOrigin()}${localizePath(path, locale)}`;
const longDate = (d: Date, locale: Locale) => new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { month: "long", day: "numeric", timeZone: SEASON_TIME_ZONE }).format(d);

export type DigestResult = { families: number; sent: number; failed: number };

export async function sendFamilyDigests(now = new Date()): Promise<DigestResult> {
  const since = new Date(now.getTime() - LOOK_BACK_DAYS * DAY_MS);
  const [money, deeds] = await Promise.all([
    Transaction.find({ type: trusted({ $in: [...NEWS_TYPES] }), createdAt: trusted({ $gte: since, $lte: now }) })
      .select("familyId kidId amountCentipoints createdAt")
      .limit(50_000)
      .lean<{ familyId: unknown; kidId: unknown; amountCentipoints: number; createdAt: Date }[]>(),
    Deed.find({ status: "confirmed", confirmedAt: trusted({ $gte: since, $lte: now }) })
      .select("familyId kidId confirmedAt")
      .limit(50_000)
      .lean<{ familyId: unknown; kidId: unknown; confirmedAt: Date }[]>(),
  ]);
  const fids = [...new Set([...money, ...deeds].map((r) => String(r.familyId)))];
  if (fids.length === 0) return { families: 0, sent: 0, failed: 0 };
  const families = await Family.find({ _id: trusted({ $in: fids }) }).select("ownerUserId notify").lean<FamilyRow[]>();
  const [parents, kids] = await Promise.all([
    parentsOf(families),
    Kid.find({ familyId: trusted({ $in: fids }), archivedAt: null }).select("firstName familyId").sort({ createdAt: 1 }).lean<{ _id: unknown; firstName: string; familyId: unknown }[]>(),
  ]);

  const inputs: SendEmailInput<EmailTemplateName>[] = [];
  const upTo: { fid: string; at: Date }[] = []; // same order as inputs
  for (const f of families) {
    const fid = String(f._id);
    const parent = parents.get(fid);
    const prefs = prefsOf(f.notify);
    if (!parent || (!prefs.magic && !prefs.deeds)) continue;
    const after = f.notify?.lastDigestAt ? new Date(f.notify.lastDigestAt).getTime() : since.getTime();
    const m = prefs.magic ? money.filter((r) => String(r.familyId) === fid && new Date(r.createdAt).getTime() > after) : [];
    const d = prefs.deeds ? deeds.filter((r) => String(r.familyId) === fid && new Date(r.confirmedAt).getTime() > after) : [];
    const rows = kids
      .filter((k) => String(k.familyId) === fid)
      .map((k) => {
        const cp = m.filter((r) => String(r.kidId) === String(k._id)).reduce((s, r) => s + r.amountCentipoints, 0);
        const n = d.filter((r) => String(r.kidId) === String(k._id)).length;
        return { kid: k.firstName, points: cp > 0 ? formatPoints(cp, parent.locale === "es" ? "es-US" : "en-US") : undefined, deeds: n || undefined };
      })
      .filter((r) => r.points || r.deeds);
    if (rows.length === 0) continue;
    // "Reported up to" = the newest item included (not "now"): something written while this run
    // was reading is reported tomorrow instead of never.
    const newest = Math.max(...m.map((r) => new Date(r.createdAt).getTime()), ...d.map((r) => new Date(r.confirmedAt).getTime()));
    inputs.push({
      to: parent.email,
      locale: parent.locale,
      template: "familyDigest",
      values: { link: familyLink(parent.locale, "/"), lines: digestLines(parent.locale, rows) },
      optOutLinks: optOutLinksFor(fid, "digest", parent.locale),
    });
    upTo.push({ fid, at: new Date(newest) });
  }
  if (inputs.length === 0) return { families: 0, sent: 0, failed: 0 };
  const { sent, failed } = await sendEmailBatch(inputs, `digest/${isoDay(calendarDateIn(now))}`);
  for (const i of sent) {
    const u = upTo[i]!;
    await Family.updateOne({ _id: u.fid }, { $set: { "notify.lastDigestAt": u.at } });
  }
  return { families: inputs.length, sent: sent.length, failed: failed.length };
}

export type ReminderResult = { cutoff: { sent: number; failed: number } | "notTime"; payUp: { sent: number; failed: number } | "notTime" };

/** Is `now` within the REMINDER_DAYS_BEFORE days before `at`? */
const dueBefore = (at: Date, now: Date) => now.getTime() >= at.getTime() - REMINDER_DAYS_BEFORE * DAY_MS && now.getTime() < at.getTime();

export async function sendSeasonReminders(now = new Date()): Promise<ReminderResult> {
  const season = await getSeasonState(now);
  const freezeAt = startOfDayInZone(season.dates.freeze);
  const result: ReminderResult = { cutoff: "notTime", payUp: "notTime" };

  // Lists freeze soon: every family with a registered child.
  if (season.phase === "open" && dueBefore(freezeAt, now)) {
    const fids = ((await Kid.distinct("familyId", { archivedAt: null, "registration.status": "registered" })) as unknown[]).map(String);
    result.cutoff = await remind(fids, "cutoffSentYear", season.year, "cutoffReminder", "/", freezeAt, now);
  }
  // Last days to finish gifts: families with an unfinished gift this season.
  const win = await payUpWindow(now);
  if (win.open && dueBefore(win.closesAt, now)) {
    const fids = ((await WishListItem.distinct("familyId", { seasonYear: win.seasonYear, status: "active" })) as unknown[]).map(String);
    result.payUp = await remind(fids, "payUpSentYear", win.seasonYear, "payUpReminder", "/parent/payup", win.closesAt, now);
  }
  return result;
}

async function remind(
  fids: string[],
  field: "cutoffSentYear" | "payUpSentYear",
  year: number,
  template: "cutoffReminder" | "payUpReminder",
  path: string,
  date: Date,
  now: Date,
): Promise<{ sent: number; failed: number }> {
  if (fids.length === 0) return { sent: 0, failed: 0 };
  const families = await Family.find({ _id: trusted({ $in: fids }), [`notify.${field}`]: trusted({ $ne: year }) })
    .select("ownerUserId notify")
    .limit(20_000)
    .lean<FamilyRow[]>();
  const parents = await parentsOf(families);
  const targets = families.filter((f) => prefsOf(f.notify).reminders && parents.has(String(f._id)));
  const inputs = targets.map((f): SendEmailInput<EmailTemplateName> => {
    const p = parents.get(String(f._id))!;
    return { to: p.email, locale: p.locale, template, values: { link: familyLink(p.locale, path), date: longDate(date, p.locale) }, optOutLinks: optOutLinksFor(String(f._id), "reminders", p.locale) };
  });
  if (inputs.length === 0) return { sent: 0, failed: 0 };
  const { sent, failed } = await sendEmailBatch(inputs, `${template}/${year}/${isoDay(calendarDateIn(now))}`);
  const done = sent.map((i) => String(targets[i]!._id));
  if (done.length) await Family.updateMany({ _id: trusted({ $in: done }) }, { $set: { [`notify.${field}`]: year } });
  return { sent: sent.length, failed: failed.length };
}
