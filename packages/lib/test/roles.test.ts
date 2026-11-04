import { test } from "node:test";
import assert from "node:assert/strict";
import { isRoleAllowedInApp, roleSchema } from "../src/roles.ts";

test("each app admits only its own roles", () => {
  assert.equal(isRoleAllowedInApp("parent", "family"), true);
  assert.equal(isRoleAllowedInApp("parent", "admin"), false);
  assert.equal(isRoleAllowedInApp("store_rep", "store"), true);
  assert.equal(isRoleAllowedInApp("admin", "family"), false);
});

test("role schema rejects unknown roles", () => {
  assert.equal(roleSchema.safeParse("community").success, false);
  assert.equal(roleSchema.safeParse("admin").success, true);
});
