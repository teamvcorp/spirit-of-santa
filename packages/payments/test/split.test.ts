// No-database tests for the community-donation split maths (src/split.ts planSplit/shareOf).
// The database run is covered end-to-end by scripts/e2e/browser-donation-split.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSplit, shareOf, type KidRef } from "../src/split.ts";

const kid = (n: number, fam = `f${n}`): KidRef => ({ id: `k${n}`, familyId: fam });

test("fee off the top (rounded down), equal shares, leftover to the platform", () => {
  // $100 at 10%: fee $10, $90 net = 6000 centipoints ($1.50/point), 7 kids → 857 each, 1 left over.
  assert.deepEqual(shareOf(10_000, 1000, 7), { feeCents: 1000, per: 857, leftover: 1 });
  // 12.5% of $25.01 = 312.625 → 312 (the platform never takes more than its %).
  assert.equal(shareOf(2501, 1250, 1).feeCents, 312);
  // 0% fee: everything becomes points.
  assert.deepEqual(shareOf(150, 0, 1), { feeCents: 0, per: 100, leftover: 0 });
  // No kids → nobody gets anything.
  assert.equal(shareOf(10_000, 1000, 0).per, 0);
});

test("ZIP pools go to that ZIP's kids; an empty ZIP rolls into 'all kids' (fee taken once)", () => {
  const a = kid(1), b = kid(2), c = kid(3);
  const byZip = new Map([["50588", [a, b]]]);
  const plans = planSplit(
    [
      { zip: "50588", cents: 3000, paymentIds: ["p1"] },
      { zip: "99999", cents: 1500, paymentIds: ["p2"] }, // nobody registered there
      { zip: null, cents: 1500, paymentIds: ["p3"] },
    ],
    byZip,
    [a, b, c],
    1000,
  );
  const zip = plans.find((p) => p.zip === "50588")!;
  assert.equal(zip.status, "split");
  assert.deepEqual(zip.recipients, [a, b]);
  assert.equal(zip.feeCents, 300); // 10% of $30
  assert.equal(zip.perKidCentipoints, 900); // $27 net = 1800 cp, 2 kids
  const rolled = plans.find((p) => p.zip === "99999")!;
  assert.equal(rolled.status, "rolled");
  assert.equal(rolled.feeCents, 0); // no fee taken twice
  const all = plans.find((p) => p.zip === null)!;
  assert.equal(all.totalCents, 3000); // $15 own + $15 rolled
  assert.deepEqual(all.paymentIds.sort(), ["p2", "p3"]);
  assert.equal(all.feeCents, 300);
  assert.equal(all.perKidCentipoints, 600); // $27 net = 1800 cp, 3 kids
});

test("a pool too small for 1 centipoint each stays held (not shared, nothing settled)", () => {
  const kids = Array.from({ length: 1000 }, (_, i) => kid(i));
  const [p] = planSplit([{ zip: null, cents: 500, paymentIds: ["p1"] }], new Map(), kids, 1000);
  assert.equal(p!.status, "tooSmall");
  assert.deepEqual(p!.paymentIds, []);
  assert.deepEqual(p!.recipients, []);
});

test("no held gifts → no plans", () => {
  assert.deepEqual(planSplit([], new Map(), [kid(1)], 1000), []);
});
