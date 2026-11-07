/**
 * E2E for the Phase 8 "spend at lock" fix and its one-off data correction (packages/db/scripts/backfill-spend-at-lock.ts).
 * Owner rule (2026-11-07): record magic as SPENT at lock, so money is never counted twice.
 *
 *   node --conditions=react-server --env-file=apps/family/.env.local scripts/e2e/ledger-invariants.ts
 *
 * Kids, one case each: Ava normal lock · Ben escrow out of sync (lock must PARK, not lock) · Cal old-style locked
 * gift without a spend (correction FIXES it) · Dee unexplained extra escrow · Eve escrow short · Fay locked gift
 * with no escrow history (all three REPORTED, untouched) · Gus deploy window (new lock first, then correction) ·
 * an orphan gift whose kid was deleted (spend booked, no kid written). The correction runs as the real CLI,
 * limited to these kids (--kid), so other data in the shared dev database is never touched.
 * *_dev database only; creates and removes its own data.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connectDb, Kid, Transaction, trusted, WishListItem } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { lockFundedItems } from "@repo/wishlists/engine";
import { ledgerProblems } from "@repo/wishlists/ledger-check";
import { makeChecks } from "./lib.ts";

const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
const oid = () => new mongoose.Types.ObjectId();
const year = getSeasonYear();
const DAY = 86_400_000;
const familyId = oid();
const storeId = oid();
const kidIds: mongoose.Types.ObjectId[] = [];

/** A kid whose ledger shows `earned` coming in; balances set as given (to stage each case). */
async function mkKid(name: string, escrowed: number, earned: number, available = 0) {
  const k = await Kid.create({ familyId, firstName: `${name}${tag}`, birthYear: 2016, displayName: "X.", availableCentipoints: available, escrowedCentipoints: escrowed, registration: { status: "registered", registeredAt: new Date(), method: "card" } });
  kidIds.push(k._id);
  if (earned > 0) await Transaction.collection.insertOne({ kidId: k._id, familyId, seasonYear: year, type: "earn_tip", amountCentipoints: earned, createdAt: new Date() });
  return k._id;
}
/** A gift; `escrowRow` = the ledger shows its magic going into escrow (as the engine books it). */
async function mkGift(kidId: unknown, status: string, funded: number, opts: { escrowRow?: boolean; daysAgo?: number } = {}) {
  const _id = oid();
  await WishListItem.collection.insertOne({ _id, kidId, familyId, itemId: oid(), storeId, seasonYear: year, costCentipoints: funded, fundedCentipoints: funded, status, fullyFundedAt: new Date(Date.now() - (opts.daysAgo ?? 40) * DAY), ...(status === "locked" ? { lockedAt: new Date() } : {}), createdAt: new Date(), updatedAt: new Date() });
  if (opts.escrowRow !== false) await Transaction.collection.insertOne({ kidId, familyId, seasonYear: year, type: "escrow", amountCentipoints: funded, wishListItemId: _id, createdAt: new Date() });
  return _id;
}
const kid = async (id: unknown) => (await Kid.findById(id).lean())!;
const spends = (giftId: unknown) => Transaction.countDocuments({ wishListItemId: giftId, type: "spend" });
const problems = async (id: unknown) =>
  ledgerProblems(await kid(id), await Transaction.find({ kidId: id }).lean(), await WishListItem.find({ kidId: id }).select("status fundedCentipoints").lean());
/** Run the REAL correction CLI for our kids only; returns its output. */
const backfill = (...flags: string[]) =>
  execFileSync(process.execPath, ["--conditions=react-server", "packages/db/scripts/backfill-spend-at-lock.ts", ...flags, ...kidIds.flatMap((k) => ["--kid", String(k)])], { encoding: "utf8", env: process.env });
const statusOf = (out: string, id: unknown) => new RegExp(`${String(id)}.*\\s(\\w+)$`, "m").exec(out)?.[1];

try {
  // ── Ava: normal lock (new engine). Fully funded 31+ days → locked, ONE spend, escrow back to 0.
  const ava = await mkKid("Ava", 1000, 1000);
  const avaGift = await mkGift(ava, "fully_funded", 1000, { daysAgo: 31 });
  // ── Ben: escrow LOWER than the gift holds (out of sync) → the lock must PARK it, not lock it blindly.
  const ben = await mkKid("Ben", 400, 1000, 600);
  const benGift = await mkGift(ben, "fully_funded", 1000, { daysAgo: 31 });
  // ── Gus (deploy window): an OLD locked gift without spend + a new 31-day gift the NEW lock spends first.
  const gus = await mkKid("Gus", 1500, 1500);
  const gusOld = await mkGift(gus, "locked", 1000);
  const gusNew = await mkGift(gus, "fully_funded", 500, { daysAgo: 31 });

  const r1 = await lockFundedItems();
  check("lock result reports what it did (locked / spent / parked)", r1.locked >= 2 && r1.failed >= 1, JSON.stringify(r1));
  check("Ava: locked, ONE spend booked, escrow 1000 → 0, ledger consistent", (await WishListItem.findById(avaGift).lean())?.status === "locked" && (await spends(avaGift)) === 1 && (await kid(ava)).escrowedCentipoints === 0 && (await problems(ava)).length === 0, (await problems(ava)).join("; "));
  const benRow = await WishListItem.findById(benGift).lean();
  check("Ben (escrow out of sync): NOT locked, no spend, parked for a human", benRow?.status === "fully_funded" && !!benRow.lockNeedsAttentionAt && (await spends(benGift)) === 0 && (await kid(ben)).escrowedCentipoints === 400);
  check("Gus: the new gift was spent by the new lock (escrow 1500 → 1000)", (await spends(gusNew)) === 1 && (await kid(gus)).escrowedCentipoints === 1000);
  const r2 = await lockFundedItems();
  check("running the lock again: nothing spent twice; the parked gift is skipped (not re-failed)", (await spends(avaGift)) === 1 && (await kid(ava)).escrowedCentipoints === 0 && r2.needsAttention >= 1);

  // ── Correction cases (gifts locked BEFORE the fix: no spend row, escrow still holding them).
  const cal = await mkKid("Cal", 2300, 2300); // locked 2000 + open 300
  const calLocked = await mkGift(cal, "locked", 2000);
  await mkGift(cal, "active", 300);
  const dee = await mkKid("Dee", 1500, 1500); // locked 1000, but escrow 1500: 500 unexplained
  const deeGift = await mkGift(dee, "locked", 1000);
  const eve = await mkKid("Eve", 400, 1000, 600); // locked 1000, escrow only 400: short
  const eveGift = await mkGift(eve, "locked", 1000);
  const fay = await mkKid("Fay", 700, 700); // locked 700 with NO escrow history in the ledger
  const fayGift = await mkGift(fay, "locked", 700, { escrowRow: false });
  const orphanKid = oid(); // the kid was deleted (COPPA); its locked gift stays (store owed)
  kidIds.push(orphanKid);
  const orphanGift = await mkGift(orphanKid, "locked", 900);

  const dry = backfill();
  check("correction DRY RUN writes nothing", (await spends(calLocked)) === 0 && (await kid(cal)).escrowedCentipoints === 2300 && dry.includes("DRY RUN"));
  check("dry run tells what it would do: Cal FIXED, Gus FIXED, orphan ORPHAN_SPENT", statusOf(dry, cal) === "FIXED" && statusOf(dry, gus) === "FIXED" && statusOf(dry, orphanKid) === "ORPHAN_SPENT", dry.split("\n").filter((l) => l.includes(tag) || /FIXED|SHORT|EXTRA|HISTORY|ORPHAN/.test(l)).slice(0, 8).join(" | "));

  const applied = backfill("--apply");
  check("--apply: Cal gets ONE spend (2000) and escrow drops to its open gift (2300 → 300); books consistent",
    (await spends(calLocked)) === 1 && (await kid(cal)).escrowedCentipoints === 300 && (await problems(cal)).length === 0, (await problems(cal)).join("; "));
  check("--apply: Gus (deploy window) fixed too: 2 spends, escrow 0 (not reported as unexplained)",
    statusOf(applied, gus) === "FIXED" && (await spends(gusOld)) === 1 && (await kid(gus)).escrowedCentipoints === 0 && (await problems(gus)).length === 0);
  check("--apply: orphan gift gets its spend; no kid record is created", (await spends(orphanGift)) === 1 && !(await Kid.exists({ _id: orphanKid })));
  check("Dee (unexplained extra escrow): REPORTED, untouched", statusOf(applied, dee) === "UNEXPLAINED_EXTRA" && (await spends(deeGift)) === 0 && (await kid(dee)).escrowedCentipoints === 1500);
  check("Eve (escrow short): REPORTED, untouched", statusOf(applied, eve) === "SHORT" && (await spends(eveGift)) === 0 && (await kid(eve)).escrowedCentipoints === 400);
  check("Fay (no escrow history): REPORTED, never booked (would take out money that never went in)", statusOf(applied, fay) === "NO_ESCROW_HISTORY" && (await spends(fayGift)) === 0);

  const again = backfill("--apply");
  check("--apply again: nothing new (never booked twice)", (await spends(calLocked)) === 1 && (await kid(cal)).escrowedCentipoints === 300 && /booked 0 spend row/.test(again), again.split("\n").find((l) => l.includes("booked")));
  check("spend rows keep the gift's OWN season", (await Transaction.findOne({ wishListItemId: calLocked, type: "spend" }).lean())?.seasonYear === year);
} finally {
  await Promise.all([
    WishListItem.collection.deleteMany({ familyId }),
    Transaction.collection.deleteMany({ familyId }),
    Kid.deleteMany({ _id: trusted({ $in: kidIds }) }),
  ]);
  await mongoose.disconnect();
}
process.exitCode = report();
