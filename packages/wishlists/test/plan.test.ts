import { test } from "node:test";
import assert from "node:assert/strict";
import { planAllocation } from "../src/plan.ts";

const item = (id: string, cost: number, funded = 0) => ({ id, costCentipoints: cost, fundedCentipoints: funded });

test("oldest item fills first, then the next; the rest stays available", () => {
  const r = planAllocation(3000, [item("a", 2500), item("b", 1000), item("c", 500)]);
  assert.deepEqual(r.steps, [
    { id: "a", take: 2500, complete: true },
    { id: "b", take: 500, complete: false },
  ]);
  assert.equal(r.left, 0);
});

test("partly funded items only take what they still need", () => {
  const r = planAllocation(1000, [item("a", 2500, 2400), item("b", 1000)]);
  assert.deepEqual(r.steps, [
    { id: "a", take: 100, complete: true },
    { id: "b", take: 900, complete: false },
  ]);
});

test("more points than the list needs: leftover stays available", () => {
  const r = planAllocation(5000, [item("a", 1000), item("b", 1500, 500)]);
  assert.equal(r.left, 3000);
  assert.ok(r.steps.every((s) => s.complete));
});

test("nothing to do", () => {
  assert.deepEqual(planAllocation(0, [item("a", 100)]), { steps: [], left: 0 });
  assert.deepEqual(planAllocation(500, []), { steps: [], left: 500 });
  assert.deepEqual(planAllocation(500, [item("a", 100, 100)]), { steps: [], left: 500 });
});

test("rejects bad input", () => {
  assert.throws(() => planAllocation(-1, []));
  assert.throws(() => planAllocation(1.5, []));
});
