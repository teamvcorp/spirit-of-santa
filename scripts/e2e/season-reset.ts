/**
 * E2E for Phase 5 slice 3: the season-end job (points reset + unshared donation money retained).
 * Runs the service as if it were Jan 2 of next year (`now` is injectable; the cron uses real time)
 * and checks the admin "Season end" card + the cron route.
 *
 *   admin + store servers, then:
 *   node --conditions=react-server --env-file=apps/admin/.env.local --env-file=apps/family/.env.local \
 *        --env-file=apps/store/.env.local scripts/e2e/season-reset.ts http://localhost:3002 http://localhost:3001
 *
 * SAFETY: the job zeroes EVERY kid's points, so this test SAVES every other kid's balance first and
 * RESTORES it exactly afterwards (plus removes the ledger rows it made for them). It refuses to run
 * if a real season-end record already exists for the year, or real held gifts would be retained.
 */
import { randomBytes } from "node:crypto";
import { chromium } from "playwright-core";
import { connectDb, Family, Kid, Payment, SeasonReset, Transaction, trusted, User } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { runSeasonReset } from "@repo/payments/season-end";
import { createMfaAdmin, makeChecks } from "./lib.ts";

const [adminBase, storeBase] = process.argv.slice(2);
if (!adminBase || !storeBase) throw new Error("usage: season-reset.ts <adminUrl> <storeUrl>");
// eslint-disable-next-line turbo/no-undeclared-env-vars
const cronSecret = process.env.CRON_SECRET ?? "";
if (cronSecret.length < 16) throw new Error("CRON_SECRET missing (pass --env-file=apps/store/.env.local)");
const { check, report } = makeChecks();
const tag = randomBytes(4).toString("hex");
const ended = getSeasonYear(new Date()); // this season…
const fakeNow = new Date(`${ended + 1}-01-02T18:00:00Z`); // …as if it were Jan 2 of next year

const mongoose = await connectDb();
if (!mongoose.connection.name.endsWith("_dev")) throw new Error("refusing: not a *_dev database");
if (await SeasonReset.exists({ seasonYear: ended })) throw new Error(`refusing: a season-end record for ${ended} already exists`);
if ((await Payment.countDocuments({ purpose: "donation", fulfilment: "held", seasonYear: ended })) > 0) throw new Error("refusing: real held gifts would be retained");

// Save every existing kid's balance (e.g. your own test kids) to restore later.
const saved = await Kid.find({ availableCentipoints: trusted({ $gt: 0 }) }).select("_id availableCentipoints").lean<{ _id: unknown; availableCentipoints: number }[]>();
console.log(`(saving ${saved.length} existing kid balance(s) to restore afterwards)`);

const user = await User.create({ email: `e2e-reset-${tag}@spiritofsanta.test`, passwordHash: "x".repeat(60), role: "parent", status: "active" });
const fam = await Family.create({ ownerUserId: user._id, familyName: `Reset ${tag}`, consent: { version: "test", acceptedAt: new Date() } });
const reg = { status: "registered", registeredAt: new Date(), method: "card" };
const k1 = await Kid.create({ familyId: fam._id, firstName: "R1", birthYear: 2017, displayName: "R.", registration: reg, availableCentipoints: 1000 });
const k2 = await Kid.create({ familyId: fam._id, firstName: "R2", birthYear: 2018, displayName: "R.", registration: reg, availableCentipoints: 250 });
const k3 = await Kid.create({ familyId: fam._id, firstName: "R3", birthYear: 2019, displayName: "R.", registration: reg }); // 0 points
const piIds = [`pi_e2ereset${randomBytes(6).toString("hex")}`, `pi_e2ereset${randomBytes(6).toString("hex")}`];
await Payment.create({ stripePaymentIntentId: piIds[0], livemode: false, purpose: "donation", status: "succeeded", seasonYear: ended, amountCents: 2000, currency: "usd", fulfilment: "held", zip: "00703" });
await Payment.create({ stripePaymentIntentId: piIds[1], livemode: false, purpose: "donation", status: "succeeded", seasonYear: ended, amountCents: 900, currency: "usd", fulfilment: "credited" });
const admin = await createMfaAdmin(`e2e-reset-admin-${tag}@spiritofsanta.test`);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const bal = async (id: unknown) => (await Kid.findById(id).lean())?.availableCentipoints ?? -1;

try {
  // 1. Not the off-season (real date, season running): nothing happens.
  const real = await runSeasonReset();
  check("during the season: nothing reset", !real.ok && real.reason === "notOffseason" && (await bal(k1._id)) === 1000);
  const cronRes = await fetch(`${storeBase}/api/cron/donations`, { headers: { authorization: `Bearer ${cronSecret}` } });
  const cronBody = (await cronRes.json()) as { seasonEnd?: { reason?: string } };
  check("daily cron includes the season-end step (not its time yet)", cronRes.status === 200 && cronBody.seasonEnd?.reason === "notOffseason", JSON.stringify(cronBody.seasonEnd));

  // 2. Jan 2: points to zero with ledger rows; unshared money retained; credited gifts untouched.
  const r = await runSeasonReset(fakeNow);
  check("season end ran for the ended season", r.ok && r.seasonYear === ended, JSON.stringify(r));
  check("test kids at 0 points", (await bal(k1._id)) === 0 && (await bal(k2._id)) === 0 && (await bal(k3._id)) === 0);
  const rows = await Transaction.find({ kidId: trusted({ $in: [k1._id, k2._id, k3._id] }), type: "season_reset" }).lean();
  check("one 'season_reset' ledger row per kid that had points, for the exact amount",
    rows.length === 2 && rows.some((t) => String(t.kidId) === String(k1._id) && t.amountCentipoints === 1000) && rows.some((t) => String(t.kidId) === String(k2._id) && t.amountCentipoints === 250) && rows.every((t) => t.seasonYear === ended));
  const [p0, p1] = await Promise.all([Payment.findOne({ stripePaymentIntentId: piIds[0] }).lean(), Payment.findOne({ stripePaymentIntentId: piIds[1] }).lean()]);
  check("unshared gift → retained; an already-shared gift untouched", p0?.fulfilment === "retained" && p1?.fulfilment === "credited");
  const rec = await SeasonReset.findOne({ seasonYear: ended }).lean();
  check("season-end record: done, totals include the test data", rec?.status === "done" && rec.retainedCents === 2000 && rec.retainedCount === 1 && (rec.centipointsReset ?? 0) >= 1250 && (rec.kidsReset ?? 0) >= 2);

  // 3. Running again does nothing.
  await Kid.updateOne({ _id: k3._id }, { $set: { availableCentipoints: 77 } }); // (a next-season point)
  const again = await runSeasonReset(fakeNow);
  check("second run: already done, next-season points untouched", !again.ok && again.reason === "alreadyDone" && (await bal(k3._id)) === 77);

  // 4. Admin sees it.
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${adminBase}/signin`);
  await page.waitForFunction(() => [...document.querySelectorAll("main button[type=submit]")].filter((x) => x.checkVisibility()).every((x) => !(x as HTMLButtonElement).disabled), undefined, { timeout: 60_000 });
  await page.fill('[name="email"]', admin.email);
  await page.fill('[name="password"]', admin.password);
  await page.fill('[name="code"]', await admin.nextCode());
  await page.click("main:visible button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("signin"), { timeout: 60_000 });
  await page.goto(`${adminBase}/donations`);
  await page.locator('main:visible [data-testid="resets"]').waitFor({ timeout: 60_000 });
  const line = await page.locator('main:visible [data-testid="resets"] li').first().innerText();
  check("admin 'Season end' card shows the run", line.includes(`Season ${ended}`) && line.includes("$20.00"), line);
} catch (err) {
  report();
  console.error("CRASHED:", err);
  throw err;
} finally {
  await browser.close();
  // Restore every saved balance exactly, and remove the reset rows this test made for those kids.
  for (const s of saved) {
    await Kid.collection.updateOne({ _id: s._id as never }, { $set: { availableCentipoints: s.availableCentipoints } });
    await Transaction.collection.deleteMany({ kidId: s._id as never, type: "season_reset", seasonYear: ended });
  }
  await SeasonReset.collection.deleteOne({ seasonYear: ended });
  await Transaction.collection.deleteMany({ kidId: { $in: [k1._id, k2._id, k3._id] } });
  await Payment.collection.deleteMany({ stripePaymentIntentId: { $in: piIds } });
  await Kid.collection.deleteMany({ familyId: fam._id });
  await Family.collection.deleteOne({ _id: fam._id });
  await User.collection.deleteMany({ _id: { $in: [user._id, new mongoose.Types.ObjectId(admin.id)] } });
  const back = await Kid.find({ _id: trusted({ $in: saved.map((s) => s._id) }) }).select("availableCentipoints").lean();
  console.log(`(restored ${back.filter((b, i) => b.availableCentipoints === saved.find((s) => String(s._id) === String(b._id))?.availableCentipoints).length}/${saved.length} saved balance(s))`);
  void back;
  await mongoose.disconnect();
}
process.exit(report());
