import { test } from "node:test";
import assert from "node:assert/strict";
import { orderPartners, publicPartnerStatus } from "../src/partners.ts";

test("publicPartnerStatus: invited → pending, pending → processing; rejected/suspended are not listed", () => {
  assert.equal(publicPartnerStatus("invited"), "pending");
  assert.equal(publicPartnerStatus("pending"), "processing");
  assert.equal(publicPartnerStatus("approved"), "approved");
  assert.equal(publicPartnerStatus("declined"), "declined");
  assert.equal(publicPartnerStatus("rejected"), null);
  assert.equal(publicPartnerStatus("suspended"), null);
});

test("orderPartners: by status group then name, case-insensitive", () => {
  const rows = [
    { name: "zeta", status: "declined" as const },
    { name: "Beta", status: "approved" as const },
    { name: "alpha", status: "approved" as const },
    { name: "Gamma", status: "pending" as const },
    { name: "delta", status: "processing" as const },
  ];
  assert.deepEqual(orderPartners(rows).map((r) => r.name), ["alpha", "Beta", "delta", "Gamma", "zeta"]);
});

test("HARD RULE: the Christmas Magic donor star never changes the order", () => {
  const names = ["Acme", "bolt", "Cobalt", "dune", "Ember", "fjord"];
  const statuses = ["approved", "processing", "pending", "declined"] as const;
  const base = names.map((name, i) => ({ name, status: statuses[i % 4]!, donor: false }));
  const plain = orderPartners(base).map((r) => r.name);
  // Every combination of donors gives the identical order.
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const withStars = base.map((r, i) => ({ ...r, donor: (mask & (1 << i)) !== 0 }));
    assert.deepEqual(orderPartners(withStars).map((r) => r.name), plain);
  }
});
