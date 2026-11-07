import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUDIT_ACTIONS } from "../src/models/audit-log.ts";

// Every audit action needs a readable label in the admin app (dashboard "recent activity", user history), in
// BOTH languages. 16 were missing until 2026-11-07: the dashboard showed raw codes. This test keeps it that way.
test("every audit action has an admin label in English and Spanish", () => {
  for (const locale of ["en", "es"]) {
    const labels = JSON.parse(readFileSync(new URL(`../../../apps/admin/messages/${locale}.json`, import.meta.url), "utf8")).AuditActions as Record<string, string>;
    const missing = AUDIT_ACTIONS.filter((a) => !labels[a.replace(/\./g, "_")]);
    assert.deepEqual(missing, [], `${locale}: missing labels for ${missing.join(", ")}`);
  }
});
