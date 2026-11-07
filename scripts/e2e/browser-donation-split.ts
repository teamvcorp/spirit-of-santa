/**
 * Real-browser E2E (Edge) for Phase 5 slice 2b: the community-donation split (admin /donations +
 * the family app's daily money cron /api/cron/money).
 *
 *   family/admin/store servers (dev or `next start`; restart dev servers after model changes), then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *        scripts/e2e/browser-donation-split.ts http://localhost:3002 http://localhost:3000
 *
 * SAFETY: credits only kids it creates, in test-only ZIPs (00701/00702), and refuses to run if the
 * dev database already holds donation gifts (a run shares EVERY held pool). Temporarily force-
 * freezes the season and sets the fee; restores the season + settings documents exactly.
 */
import { randomBytes } from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { AuditLog, connectDb, DonationSplit, Family, Kid, Payment, PlatformSettings, Season, Transaction, trusted, User } from "@repo/db";
import { calendarDateIn, getSeasonYear, isoDay } from "@repo/lib/season";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [adminBase, familyBase] = process.argv.slice(2);
if (!adminBase || !familyBase) throw new Error("usage: browser-donation-split.ts <adminUrl> <familyUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const cronSecret = process.env.CRON_SECRET ?? "";
if (cronSecret.length < 16) throw new Error("CRON_SECRET missing (in apps/family/.env.local)");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const year = getSeasonYear(new Date());

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
if ((await Payment.countDocuments({ purpose: "donation", fulfilment: "held" })) > 0) {
  throw new Error("refusing: the dev database already has held donation gifts (a split would share them). Remove them first.");
}
// Save what we change, restore it at the end.
const savedSettings = await PlatformSettings.collection.findOne({ key: "platform" });
const savedSeason = await Season.collection.findOne({ year });
await PlatformSettings.collection.updateOne({ key: "platform" }, { $set: { donationFeeBps: 1000 } }, { upsert: true }); // 10%
// A REAL freeze starting today (review 2026-11-07): the split needs phase "frozen" AND today >= the freeze date,
// so the emergency freeze alone must not be enough (checked in step 6).
const today = isoDay(calendarDateIn(new Date()));
await Season.collection.updateOne({ year }, { $set: { freezeDate: today, forceFrozen: false } }, { upsert: true });

const reg = { status: "registered", registeredAt: new Date(), method: "card" };
const mk = async (zip: string) => {
  const u = await User.create({ email: `e2e-split-${zip}-${tag}@spiritofsanta.test`, passwordHash: "x".repeat(60), role: "parent", status: "active" });
  return Family.create({ ownerUserId: u._id, familyName: `Split ${zip} ${tag}`, zip, consent: { version: "test", acceptedAt: new Date() } }).then((f) => ({ u, f }));
};
const F1 = await mk("00701");
const F2 = await mk("00702");
const a1 = await Kid.create({ familyId: F1.f._id, firstName: "A1", birthYear: 2017, displayName: "A.", registration: reg });
const a2 = await Kid.create({ familyId: F1.f._id, firstName: "A2", birthYear: 2018, displayName: "A.", registration: reg });
const a3 = await Kid.create({ familyId: F1.f._id, firstName: "A3", birthYear: 2019, displayName: "A." }); // awaiting: gets nothing
const b1 = await Kid.create({ familyId: F2.f._id, firstName: "B1", birthYear: 2016, displayName: "B.", registration: reg });
const piIds: string[] = [];
const held = async (zip: string, cents: number, extra: object = {}) => {
  const id = `pi_e2esplit${randomBytes(6).toString("hex")}`;
  piIds.push(id);
  await Payment.create({ stripePaymentIntentId: id, livemode: false, purpose: "donation", status: "succeeded", seasonYear: year, amountCents: cents, currency: "usd", fulfilment: "held", zip, succeededAt: new Date(), ...extra });
  return id;
};
await held("00701", 3000);
await held("00701", 1500); // 00701 pool: $45
await held("00702", 1000); // 00702 pool: $10
// Refunded before the split (flagged): must NEVER become points.
const refundedId = await held("00701", 5000, { refundedCents: 5000, needsReview: true, reviewReason: "refund (test)" });
const admin = await createMfaAdmin(`e2e-split-admin-${tag}@spiritofsanta.test`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const page = await (await browser.newContext()).newPage();
page.on("pageerror", (e) => errors.push(e.message));
const hydrated = (p: Page) =>
  p.waitForFunction(() => {
    const b = [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility());
    return b.length > 0 && b.every((x) => !(x as HTMLButtonElement).disabled);
  }, undefined, { timeout: 60_000 });
const open = async () => {
  await page.goto(`${adminBase}/donations`);
  await page.locator("main:visible h1").first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
};
const balance = async (id: unknown) => (await Kid.findById(id).lean())?.availableCentipoints ?? -1;
/** The split form's own result (role=status for info, role=alert for errors). */
const splitResult = async (tick: boolean) => {
  const form = page.locator("main:visible form").filter({ has: page.getByRole("button", { name: "Split now" }) });
  await form.evaluate((f) => f.querySelectorAll("[role=alert], [role=status]").forEach((a) => a.remove()));
  if (tick) await form.locator('input[name="confirm"]').check();
  await form.getByRole("button", { name: "Split now" }).click();
  const r = page.locator("main:visible form [role=alert], main:visible form [role=status]").first();
  await r.waitFor({ timeout: 60_000 });
  return r.innerText();
};
const cron = (auth?: string) => fetch(`${familyBase}/api/cron/money`, auth ? { headers: { authorization: auth } } : {});

try {
  // 1. The cron refuses strangers.
  check("cron without the secret → 401", (await cron()).status === 401 && (await cron("Bearer wrong-secret-xxxxxxxxxx")).status === 401);

  // 2. Admin sees the pools with the maths before anything happens.
  await page.goto(`${adminBase}/signin`);
  await hydrated(page);
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  check("admin header has a Donations link", (await page.locator('header a[href$="/donations"]').count()) > 0);
  await open();
  const row1 = await page.locator('main:visible tr[data-pool="00701"]').innerText();
  check("pool 00701: 2 gifts, $45, fee $4.50, 2 children, 13.5 points each (awaiting child excluded)",
    row1.split(/\s+/).join(" ") === "00701 2 $45.00 $4.50 2 13.5 Shared", row1);

  // 3. Needs the tick; then shares; audited.
  await hydrated(page);
  check("split without the tick refused", (await splitResult(false)).includes("Tick the box"));
  const done = await splitResult(true);
  check("split: $55 shared among 3 children, fee $5.50", done.includes("$55.00") && done.includes("3 children") && done.includes("$5.50"), done);
  check("balances: A1 = A2 = 13.50 points, B1 = 6.00, the awaiting child 0",
    (await balance(a1._id)) === 1350 && (await balance(a2._id)) === 1350 && (await balance(b1._id)) === 600 && (await balance(a3._id)) === 0);
  const tx = await Transaction.find({ kidId: trusted({ $in: [a1._id, a2._id, b1._id, a3._id] }) }).lean();
  check("3 ledger rows 'earn_donation' with idempotency keys", tx.length === 3 && tx.every((t) => t.type === "earn_donation" && /^donation-split:/.test(t.idempotencyKey ?? "")));
  const pays = await Payment.find({ stripePaymentIntentId: trusted({ $in: piIds.filter((id) => id !== refundedId) }) }).lean();
  const splitIds = [...new Set(pays.map((p) => String(p.splitId)))];
  check("all 3 gifts settled (credited) by one run", pays.length === 3 && pays.every((p) => p.fulfilment === "credited" && p.splitId) && splitIds.length === 1);
  const refunded = await Payment.findOne({ stripePaymentIntentId: refundedId }).lean();
  check("the refunded gift was NOT shared (still held, no run)", refunded?.fulfilment === "held" && !refunded.splitId);
  const run = await DonationSplit.findById(splitIds[0]).lean();
  check("run recorded: $55, fee $5.50, 3 kids, by admin; audited",
    run?.totalCents === 5500 && run.feeCents === 550 && run.kidsCredited === 3 && run.trigger === "admin" &&
      (await AuditLog.countDocuments({ actorUserId: admin.id, action: "donations.split" })) === 1);

  // 4. Running again shares nothing twice.
  await open();
  check("nothing left: the split button is disabled", await page.locator("main:visible").getByRole("button", { name: "Split now" }).isDisabled());
  check("past run listed", (await page.locator('main:visible [data-testid="runs"] li').count()) >= 1);

  // 4b. An interrupted run (e.g. a timeout after crediting A1 but not A2) is FINISHED by the next
  //     run, crediting only the kid that was missed.
  await DonationSplit.collection.updateOne({ _id: new mongoose.Types.ObjectId(splitIds[0]) }, { $set: { status: "crediting" } });
  await Transaction.collection.deleteOne({ kidId: a2._id, type: "earn_donation" });
  await Kid.collection.updateOne({ _id: a2._id }, { $inc: { availableCentipoints: -1350 } });
  const resume = (await (await cron(`Bearer ${cronSecret}`)).json()) as { split?: { resumed?: number } };
  check("interrupted run finished: only A2 credited again (A1 not doubled), run marked done",
    resume.split?.resumed === 1 && (await balance(a2._id)) === 1350 && (await balance(a1._id)) === 1350 &&
      (await DonationSplit.findById(splitIds[0]).lean())?.status === "done", JSON.stringify(resume));

  // 5. A late gift is shared by the next daily cron.
  await held("00702", 1500);
  const res = await cron(`Bearer ${cronSecret}`);
  const body = (await res.json()) as { split?: { ok?: boolean; kidsCredited?: number } };
  check("daily cron shares the late gift (1 child)", res.status === 200 && body.split?.ok === true && body.split.kidsCredited === 1, JSON.stringify(body));
  check("B1 now 6.00 + 9.00 = 15.00 points; others unchanged", (await balance(b1._id)) === 1500 && (await balance(a1._id)) === 1350);
  check("cron run recorded with trigger 'cron'", (await DonationSplit.countDocuments({ seasonYear: year, trigger: "cron", _id: trusted({ $in: (await Payment.find({ stripePaymentIntentId: trusted({ $in: piIds }) }).lean()).map((p) => p.splitId) }) })) === 1);

  // 6. Before the freeze date nothing can be shared, EVEN under an emergency (forced) freeze.
  await Season.collection.updateOne({ year }, { $unset: { freezeDate: "" }, $set: { forceFrozen: true } });
  await held("00701", 1000);
  const before = await (await cron(`Bearer ${cronSecret}`)).json() as { split?: { ok?: boolean; error?: string } };
  check("forced freeze before the freeze date: 'notYet', gift stays held", before.split?.ok === false && before.split.error === "notYet" &&
    (await Payment.findOne({ stripePaymentIntentId: piIds.at(-1) }).lean())?.fulfilment === "held");
  await open();
  check("admin page explains why and disables the button",
    (await page.locator("main:visible").innerText()).includes("while the season is frozen") && (await page.locator("main:visible").getByRole("button", { name: "Split now" }).isDisabled()));
  check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  const pays = await Payment.find({ stripePaymentIntentId: trusted({ $in: piIds }) }).select("splitId").lean();
  await DonationSplit.collection.deleteMany({ _id: { $in: pays.map((p) => p.splitId).filter(Boolean) } });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await Transaction.collection.deleteMany({ kidId: { $in: [a1._id, a2._id, a3._id, b1._id] } });
  await Kid.collection.deleteMany({ familyId: { $in: [F1.f._id, F2.f._id] } });
  await Family.collection.deleteMany({ _id: { $in: [F1.f._id, F2.f._id] } });
  await AuditLog.collection.deleteMany({ actorUserId: new mongoose.Types.ObjectId(admin.id) });
  await User.collection.deleteMany({ _id: { $in: [F1.u._id, F2.u._id, new mongoose.Types.ObjectId(admin.id)] } });
  // Restore the season + settings exactly.
  await Season.collection.deleteOne({ year });
  if (savedSeason) await Season.collection.insertOne(savedSeason);
  await PlatformSettings.collection.deleteOne({ key: "platform" });
  if (savedSettings) await PlatformSettings.collection.insertOne(savedSettings);
  await mongoose.disconnect();
}
process.exit(report());
