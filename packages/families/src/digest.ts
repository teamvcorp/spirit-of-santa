/**
 * Phase 7.2: the parent emails sent by the daily money job (family app /api/cron/money).
 * SERVER-ONLY. User decisions 2026-11-06: email only, parents only.
 *
 *  - Daily SUMMARY ("magic" + "deeds"): one email per family per day at most, listing per child the
 *    points received from OTHERS (tips + community donation shares; a parent's own bonus/pay-up is
 *    not news to them) and the good deeds thanked.
 *    Never twice, never lost (review 2026-11-06): each run reports news in (lastDigestAt, boundary],
 *    where boundary = now − SETTLE_MS (a ledger/deed write still inside its transaction at read time
 *    is older than that by the next run, so it can't slip behind the marker), read in time order;
 *    if a read hits its cap, the boundary moves back to the last row read and the rest waits a day.
 *  - Season REMINDERS ("reminders"): 3 days before the freeze date (lists freeze) and 3 days before
 *    the last pay-up day (only families with an unfinished gift of a registered child: exactly what
 *    /parent/payup shows). Once per season each (notify.cutoffSentYear / payUpSentYear).
 * Everything goes through sendEmailBatch (100 per request) with unsubscribe links + headers.
 * Respects each family's settings; skips parents whose account isn't active.
 */
import "server-only";
import { Deed, Family, Kid, Transaction, trusted, User, WishListItem } from "@repo/db";
import { digestLines, sendEmailBatch, type EmailTemplateName, type SendEmailInput } from "@repo/email";
import { localizePath } from "@repo/i18n/paths";
import { formatLongDate } from "@repo/lib/format";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@repo/lib/locales";
import { calendarDateIn, isoDay, startOfDayInZone } from "@repo/lib/season";
import { DAY_MS } from "@repo/lib/time";
import { getSeasonState } from "@repo/stores/season";
import { familyAppOrigin } from "@repo/stores/urls";
import { payUpWindow } from "@repo/wishlists/payup";
import { optOutLinksFor, prefsOf } from "./notifications.ts";

const LOOK_BACK_DAYS = 7;
/** News newer than this isn't reported yet (its write may still be committing). */
const SETTLE_MS = 10 * 60_000;
const READ_CAP = 50_000;
/** Reminders go out this many days before the date they're about. */
export const REMINDER_DAYS_BEFORE = 3;
/** Points from OTHER people (a parent's own bonus or pay-up is not news to that parent). */
const NEWS_TYPES = ["earn_tip", "earn_donation"] as const;
const FAMILY_PAGE = 5000;

type Notify = { magic?: boolean; deeds?: boolean; reminders?: boolean; lastDigestAt?: Date; cutoffSentYear?: number; payUpSentYear?: number };
type FamilyRow = { _id: unknown; ownerUserId: unknown; notify?: Notify };
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

/** Push into a Map of arrays. */
function group<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export type DigestResult = { families: number; sent: number; failed: number };

export async function sendFamilyDigests(now = new Date()): Promise<DigestResult> {
  const since = new Date(now.getTime() - LOOK_BACK_DAYS * DAY_MS);
  let boundary = new Date(now.getTime() - SETTLE_MS);
  const [money, deeds] = await Promise.all([
    Transaction.find({ type: trusted({ $in: [...NEWS_TYPES] }), createdAt: trusted({ $gte: since, $lte: boundary }) })
      .select("familyId kidId amountCentipoints createdAt")
      .sort({ createdAt: 1, _id: 1 })
      .limit(READ_CAP)
      .lean<{ familyId: unknown; kidId: unknown; amountCentipoints: number; createdAt: Date }[]>(),
    Deed.find({ status: "confirmed", confirmedAt: trusted({ $gte: since, $lte: boundary }) })
      .select("familyId kidId confirmedAt")
      .sort({ confirmedAt: 1, _id: 1 })
      .limit(READ_CAP)
      .lean<{ familyId: unknown; kidId: unknown; confirmedAt: Date }[]>(),
  ]);
  // Hit a cap → only report up to the last row read (oldest first); the rest is tomorrow's news.
  if (money.length === READ_CAP) boundary = new Date(Math.min(boundary.getTime(), new Date(money[money.length - 1]!.createdAt).getTime()));
  if (deeds.length === READ_CAP) boundary = new Date(Math.min(boundary.getTime(), new Date(deeds[deeds.length - 1]!.confirmedAt).getTime()));
  const end = boundary.getTime();

  // Group ONCE by family (then by kid below).
  const moneyBy = new Map<string, typeof money>();
  for (const r of money) if (new Date(r.createdAt).getTime() <= end) group(moneyBy, String(r.familyId), r);
  const deedsBy = new Map<string, typeof deeds>();
  for (const r of deeds) if (new Date(r.confirmedAt).getTime() <= end) group(deedsBy, String(r.familyId), r);
  const fids = [...new Set([...moneyBy.keys(), ...deedsBy.keys()])];
  if (fids.length === 0) return { families: 0, sent: 0, failed: 0 };

  const families = await Family.find({ _id: trusted({ $in: fids }) }).select("ownerUserId notify").lean<FamilyRow[]>();
  const [parents, kids] = await Promise.all([
    parentsOf(families),
    Kid.find({ familyId: trusted({ $in: fids }), archivedAt: null }).select("firstName familyId").sort({ createdAt: 1 }).lean<{ _id: unknown; firstName: string; familyId: unknown }[]>(),
  ]);
  const kidsBy = new Map<string, typeof kids>();
  for (const k of kids) group(kidsBy, String(k.familyId), k);

  const inputs: SendEmailInput<EmailTemplateName>[] = [];
  const emailed: string[] = []; // family ids, same order as inputs
  for (const f of families) {
    const fid = String(f._id);
    const parent = parents.get(fid);
    const prefs = prefsOf(f.notify);
    if (!parent || (!prefs.magic && !prefs.deeds)) continue;
    const after = f.notify?.lastDigestAt ? new Date(f.notify.lastDigestAt).getTime() : since.getTime();
    const pts = new Map<string, number>();
    if (prefs.magic) for (const r of moneyBy.get(fid) ?? []) if (new Date(r.createdAt).getTime() > after) pts.set(String(r.kidId), (pts.get(String(r.kidId)) ?? 0) + r.amountCentipoints);
    const nDeeds = new Map<string, number>();
    if (prefs.deeds) for (const r of deedsBy.get(fid) ?? []) if (new Date(r.confirmedAt).getTime() > after) nDeeds.set(String(r.kidId), (nDeeds.get(String(r.kidId)) ?? 0) + 1);
    const rows = (kidsBy.get(fid) ?? [])
      .map((k) => {
        const cp = pts.get(String(k._id)) ?? 0;
        const n = nDeeds.get(String(k._id)) ?? 0;
        return { kid: k.firstName, centipoints: cp || undefined, deeds: n || undefined };
      })
      .filter((r) => r.centipoints || r.deeds);
    if (rows.length === 0) continue;
    inputs.push({
      to: parent.email,
      locale: parent.locale,
      template: "familyDigest",
      values: { link: familyLink(parent.locale, "/"), lines: digestLines(parent.locale, rows) },
      optOutLinks: optOutLinksFor(fid, "digest", parent.locale),
    });
    emailed.push(fid);
  }
  if (inputs.length === 0) return { families: 0, sent: 0, failed: 0 };
  const { sent, failed } = await sendEmailBatch(inputs, `digest/${isoDay(calendarDateIn(now))}`);
  // One bulk write: everything up to the boundary has now been reported to these families.
  if (sent.length > 0) {
    await Family.bulkWrite(sent.map((i) => ({ updateOne: { filter: { _id: emailed[i] }, update: { $set: { "notify.lastDigestAt": boundary } } } })) as never);
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

  // Lists freeze soon: every family with a registered child (registration is per child, not per season).
  if (season.phase === "open" && dueBefore(freezeAt, now)) {
    const fids = ((await Kid.distinct("familyId", { archivedAt: null, "registration.status": "registered" })) as unknown[]).map(String);
    result.cutoff = await remind(fids, "cutoffSentYear", season.year, "cutoffReminder", "/", freezeAt, now);
  }
  // Last days to finish gifts: families with an unfinished gift of a REGISTERED, non-archived child
  // (the same gifts /parent/payup offers), counted against the last day pay-ups are possible.
  const win = await payUpWindow(now);
  if (win.open && dueBefore(win.closesAt, now)) {
    const rows = await WishListItem.aggregate<{ _id: unknown }>([
      { $match: { seasonYear: win.seasonYear, status: "active" } },
      { $lookup: { from: "kids", localField: "kidId", foreignField: "_id", as: "kid", pipeline: [{ $match: { archivedAt: null, "registration.status": "registered" } }, { $project: { _id: 1 } }] } },
      { $match: { "kid.0": { $exists: true } } },
      { $group: { _id: "$familyId" } },
    ]);
    result.payUp = await remind(rows.map((r) => String(r._id)), "payUpSentYear", win.seasonYear, "payUpReminder", "/parent/payup", win.lastPayDay, now);
  }
  return result;
}

/** Email every family in `fids` not yet reminded this season, in pages (no cap leaves anyone out). */
async function remind(
  fids: string[],
  field: "cutoffSentYear" | "payUpSentYear",
  year: number,
  template: "cutoffReminder" | "payUpReminder",
  path: string,
  date: Date,
  now: Date,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let start = 0; start < fids.length; start += FAMILY_PAGE) {
    const families = await Family.find({ _id: trusted({ $in: fids.slice(start, start + FAMILY_PAGE) }), [`notify.${field}`]: trusted({ $ne: year }) })
      .select("ownerUserId notify")
      .lean<FamilyRow[]>();
    const parents = await parentsOf(families);
    const targets = families.filter((f) => prefsOf(f.notify).reminders && parents.has(String(f._id)));
    if (targets.length === 0) continue;
    const inputs = targets.map((f): SendEmailInput<EmailTemplateName> => {
      const p = parents.get(String(f._id))!;
      return { to: p.email, locale: p.locale, template, values: { link: familyLink(p.locale, path), date: formatLongDate(date, p.locale) }, optOutLinks: optOutLinksFor(String(f._id), "reminders", p.locale) };
    });
    const r = await sendEmailBatch(inputs, `${template}/${year}/${isoDay(calendarDateIn(now))}/${start}`);
    const done = r.sent.map((i) => String(targets[i]!._id));
    if (done.length) await Family.updateMany({ _id: trusted({ $in: done }) }, { $set: { [`notify.${field}`]: year } });
    sent += r.sent.length;
    failed += r.failed.length;
  }
  return { sent, failed };
}
