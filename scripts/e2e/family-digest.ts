/**
 * E2E for Phase 7.2: parents' daily summary + season reminders (services called directly, the
 * dev-mode emails are captured from the console instead of being sent).
 *
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/family-digest.ts
 *
 * Moves this season's dates (and restores them). *_dev database only; removes its own data.
 * Note: other dev families with news in the last 7 days are processed too (dev prints only).
 */
import { randomBytes } from "node:crypto";
import { connectDb, Deed, Family, Item, Kid, Season, Store, Transaction, trusted, User, WishListItem } from "@repo/db";
import { sendFamilyDigests, sendSeasonReminders } from "@repo/families/digest";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { formatLongDate } from "@repo/lib/format";
import { payUpWindow } from "@repo/wishlists/payup";
import { makeChecks } from "./lib.ts";

const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const year = getSeasonYear();
const H = 3_600_000;
const DAY = 24 * H;
const dayIso = (offset: number) => isoDay(calendarDateIn(new Date(Date.now() + offset * DAY)));

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const savedSeason = await Season.collection.findOne({ year });

const mail = (n: string) => `e2e-dig-${n}-${tag}@spiritofsanta.test`;
const mkFamily = async (n: string, notify: Record<string, unknown>, status = "active") => {
  const user = await User.create({ email: mail(n), passwordHash: "x".repeat(60), role: "parent", status, locale: "en" });
  const family = await Family.create({ ownerUserId: user._id, familyName: `Dig${n}${tag}`, consent: { version: "test", acceptedAt: new Date() }, notify });
  await User.updateOne({ _id: user._id }, { $set: { familyId: family._id } });
  return { user, family };
};
const now = Date.now();
const A = await mkFamily("a", { lastDigestAt: new Date(now - 2 * H) });
const B = await mkFamily("b", { magic: false }); // deeds only
const C = await mkFamily("c", { magic: false, deeds: false, reminders: false }); // nothing
const D = await mkFamily("d", {}, "suspended"); // account not active
const E = await mkFamily("e", {}); // only an UNREGISTERED child with an unfinished gift
const reg = { status: "registered", registeredAt: new Date(), method: "card" };
const mkKid = (fam: { _id: unknown }, name: string) => Kid.create({ familyId: fam._id, firstName: `${name}${tag}`, birthYear: 2016, displayName: "X.", registration: reg });
const maya = await mkKid(A.family, "Maya");
const leo = await mkKid(A.family, "Leo");
const bo = await mkKid(B.family, "Bo");
const cy = await mkKid(C.family, "Cy");
const di = await mkKid(D.family, "Di");
const ed = await Kid.create({ familyId: E.family._id, firstName: `Ed${tag}`, birthYear: 2016, displayName: "E." }); // awaiting registration
const kidIds = [maya._id, leo._id, bo._id, cy._id, di._id, ed._id];
const tx = (k: { _id: unknown; familyId: unknown }, type: string, cp: number, agoMs: number) =>
  Transaction.collection.insertOne({ kidId: k._id, familyId: k.familyId, seasonYear: year, type, amountCentipoints: cp, createdAt: new Date(now - agoMs) });
await tx(maya, "earn_tip", 500, 1 * H);
await tx(leo, "earn_donation", 250, 1 * H);
await tx(maya, "earn_bonus", 1000, 1 * H); // the parent's own money: not news
await tx(maya, "earn_tip", 900, 3 * H); // before lastDigestAt: already reported
await tx(bo, "earn_tip", 300, 1 * H); // B has magic OFF
await tx(cy, "earn_tip", 300, 1 * H);
await tx(di, "earn_tip", 300, 1 * H);
await tx(leo, "earn_tip", 100, 2 * 60_000); // 2 minutes ago: may still be committing → reported next run
const deed = (k: { _id: unknown; familyId: unknown }, agoMs: number) =>
  Deed.collection.insertOne({ kidId: k._id, familyId: k.familyId, seasonYear: year, qrTokenHash: randomBytes(32).toString("hex"), status: "confirmed", confirmedAt: new Date(now - agoMs), createdAt: new Date(now - DAY), updatedAt: new Date() });
await deed(maya, 30 * 60_000);
await deed(bo, 30 * 60_000);
await deed(cy, 30 * 60_000);

/** Run fn, capturing the dev-mode emails it prints: to → full printed text. */
async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; mails: Map<string, string> }> {
  const lines: string[] = [];
  const orig = console.info;
  console.info = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  try {
    const result = await fn();
    const mails = new Map<string, string>();
    for (const block of lines.join("\n").split("[email:dev] ---- end")) {
      const to = /\[email:dev\] to=(\S+)/.exec(block)?.[1];
      if (to) mails.set(to, block);
    }
    return { result, mails };
  } finally {
    console.info = orig;
  }
}
const storeId = oid();
const itemId = oid();

try {
  // 1. Daily summary.
  const runAt = Date.now();
  const d1 = await capture(() => sendFamilyDigests());
  const a = d1.mails.get(mail("a")) ?? "";
  check("A: summary lists each child's news from OTHER people (tip + donation share)", a.includes(`Maya${tag}: 5 Christmas Magic · 1 good deed thanked`) && a.includes(`Leo${tag}: 2.5 Christmas Magic`));
  check("A: the parent's own bonus and already-reported news are NOT in it", !a.includes("10 Christmas Magic") && !a.includes("14 Christmas Magic") && !a.includes("9 Christmas Magic"));
  check("A: one-click unsubscribe (daily summary) + settings links in the footer", a.includes("/unsubscribe?t=") && a.includes(".digest.") && a.includes("/parent/notifications"));
  const b = d1.mails.get(mail("b")) ?? "";
  // No AMOUNT of Christmas Magic (the email's own intro text may still say the words "Christmas Magic").
  check("B (magic off): only the deed, no points", b.includes(`Bo${tag}: 1 good deed thanked`) && !/\d Christmas Magic/.test(b));
  check("C (both off) and D (account not active): no email", !d1.mails.has(mail("c")) && !d1.mails.has(mail("d")));
  check("A: the tip from 2 minutes ago is NOT in today's summary (still settling)", !a.includes("3.5 Christmas Magic") && a.includes(`Leo${tag}: 2.5 Christmas Magic`));
  const fa = await Family.collection.findOne({ _id: A.family._id });
  const upTo = (fa?.notify as { lastDigestAt?: Date })?.lastDigestAt?.getTime() ?? 0;
  check("A: 'reported up to' = the run time minus 10 minutes (settled news only)", upTo <= runAt - 10 * 60_000 + 1000 && upTo >= runAt - 10 * 60_000 - 5000);
  const d2 = await capture(() => sendFamilyDigests());
  check("second run: nothing reported twice", !d2.mails.has(mail("a")) && !d2.mails.has(mail("b")));
  // "Tomorrow" (here: 15 minutes later): the settled tip is reported, and only it.
  const d3 = await capture(() => sendFamilyDigests(new Date(Date.now() + 15 * 60_000)));
  const a3 = d3.mails.get(mail("a")) ?? "";
  check("next run: the late tip IS reported (never lost), nothing else repeated", a3.includes(`Leo${tag}: 1 Christmas Magic`) && !a3.includes(`Maya${tag}`));

  // 2. Cutoff reminder: due 3 days before the freeze date, once per season.
  await Season.collection.updateOne({ year }, { $set: { year, freezeDate: dayIso(5), forceFrozen: false }, $unset: { closeDate: 1 } }, { upsert: true });
  const r0 = await capture(() => sendSeasonReminders());
  check("5 days before the freeze: not yet", r0.result.cutoff === "notTime" && !r0.mails.has(mail("a")));
  await Season.collection.updateOne({ year }, { $set: { freezeDate: dayIso(2) } });
  const r1 = await capture(() => sendSeasonReminders());
  const ra = r1.mails.get(mail("a")) ?? "";
  check("2 days before: families with a registered child get 'lists freeze' (with the date + unsubscribe)", ra.includes("Wish lists freeze") && ra.includes(".reminders.") && r1.mails.has(mail("b")));
  check("reminders OFF (C) and account not active (D): no email", !r1.mails.has(mail("c")) && !r1.mails.has(mail("d")));
  const r2 = await capture(() => sendSeasonReminders());
  check("cutoff reminder only once per season", !r2.mails.has(mail("a")) && !r2.mails.has(mail("b")));

  // 3. Pay-up reminder: only families with an unfinished gift, 3 days before the pay-up deadline.
  await Store.collection.insertOne({ _id: storeId, name: `Dig Shop ${tag}`, slug: `e2e-dig-${tag}`, status: "approved", createdAt: new Date(), updatedAt: new Date() });
  await Item.collection.insertOne({ _id: itemId, storeId, seasonYear: year, name: `Ball ${tag}`, priceCents: 1000, inventory: 2, status: "active", createdAt: new Date(), updatedAt: new Date() });
  await WishListItem.collection.insertOne({ kidId: maya._id, familyId: A.family._id, itemId, storeId, seasonYear: year, costCentipoints: 1000, fundedCentipoints: 400, status: "active", createdAt: new Date(), updatedAt: new Date() });
  await WishListItem.collection.insertOne({ kidId: ed._id, familyId: E.family._id, itemId, storeId, seasonYear: year, costCentipoints: 1000, fundedCentipoints: 0, status: "active", createdAt: new Date(), updatedAt: new Date() });
  // freeze yesterday, close in 9 days → pay-ups close in 2 days (close − 7).
  await Season.collection.updateOne({ year }, { $set: { freezeDate: dayIso(-1), closeDate: dayIso(9) } });
  const p1 = await capture(() => sendSeasonReminders());
  const pa = p1.mails.get(mail("a")) ?? "";
  check("pay-up reminder: A (unfinished gift) gets it; B (none) and E (gift of an UNREGISTERED child) don't", pa.includes("Finish gifts before") && pa.includes("/parent/payup") && !p1.mails.has(mail("b")) && !p1.mails.has(mail("e")));
  const last = formatLongDate((await payUpWindow()).lastPayDay, "en");
  check(`pay-up reminder names the LAST day pay-ups are possible (${last}), not the first closed day`, pa.includes(`until ${last}`));
  const p2 = await capture(() => sendSeasonReminders());
  check("pay-up reminder only once per season", !p2.mails.has(mail("a")));
} finally {
  await Season.collection.deleteOne({ year });
  if (savedSeason) await Season.collection.insertOne(savedSeason);
  const fams = [A, B, C, D, E].map((x) => x.family._id);
  await Promise.all([
    Transaction.collection.deleteMany({ kidId: { $in: kidIds } }),
    Deed.collection.deleteMany({ kidId: { $in: kidIds } }),
    WishListItem.collection.deleteMany({ kidId: { $in: kidIds } }),
    Item.collection.deleteOne({ _id: itemId }),
    Store.collection.deleteOne({ _id: storeId }),
    Kid.deleteMany({ _id: trusted({ $in: kidIds }) }),
    Family.deleteMany({ _id: trusted({ $in: fams }) }),
    User.deleteMany({ _id: trusted({ $in: [A, B, C, D, E].map((x) => x.user._id) }) }),
  ]);
  await mongoose.disconnect();
}
report();
