/**
 * Load test (Phase 8, owner 2026-11-06: run on a Vercel PREVIEW deployment pointed at a *_dev database; never the
 * production site, real Stripe or real email). Simulates the season-opening rush on the PUBLIC, read-only pages
 * of the family and store apps: many visitors at once, for a fixed time. It never signs in, pays, registers or
 * sends anything, so it creates no data.
 *
 *   node scripts/load/load-test.ts --family <previewUrl> [--store <previewUrl>] [--users 50] [--seconds 60]
 *
 * Vercel preview deployments are protected: set VERCEL_AUTOMATION_BYPASS_SECRET in your shell (Vercel → Project →
 * Settings → Deployment Protection → Protection Bypass for Automation). It is sent as a header and never printed.
 *
 * Pass rules (printed at the end, exit code 1 if any fails): error rate < 1% per page, 95% of responses < 1.5 s.
 * A 429 counts as an error: if you see them, the rate limits are working, not the site failing (report them).
 *
 * Teaching notes:
 * - "users" = how many requests are in flight at the same time (each "user" loads a page, then the next).
 * - p50/p95/p99 = the time under which 50/95/99% of responses arrived. Averages hide slow outliers; p95 doesn't.
 * - The first seconds include cold starts (Vercel starting functions): look at p95 on a second run too.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    family: { type: "string" },
    store: { type: "string" },
    users: { type: "string", default: "50" },
    seconds: { type: "string", default: "60" },
  },
});
if (!values.family) throw new Error("usage: load-test.ts --family <previewUrl> [--store <previewUrl>] [--users 50] [--seconds 60]");

/** Refuse the live site: production traffic, data and Stripe must never be load-tested. */
function safeBase(raw: string): string {
  const u = new URL(raw);
  if (/(^|\.)spiritofsanta\.com$/i.test(u.hostname)) throw new Error(`refusing: ${u.hostname} is the PRODUCTION site. Use a Vercel preview URL.`);
  if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error("refusing: use https (or localhost for a dry run)");
  return u.origin;
}
const family = safeBase(values.family);
const store = values.store ? safeBase(values.store) : null;
const USERS = Math.min(500, Math.max(1, Number(values.users)));
const SECONDS = Math.min(600, Math.max(5, Number(values.seconds)));

// Public, read-only pages a new visitor opens in the first days of the season (English and Spanish).
const ROUTES = [
  `${family}/`,
  `${family}/es`,
  `${family}/donate`,
  `${family}/register`,
  `${family}/signin`,
  `${family}/privacy`,
  `${family}/terms`,
  ...(store ? [`${store}/`, `${store}/signin`, `${store}/register`] : []),
];

// eslint-disable-next-line turbo/no-undeclared-env-vars
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const headers: Record<string, string> = { "user-agent": "SpiritOfSanta-LoadTest/1.0", ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) };

type Stat = { times: number[]; errors: number; statuses: Map<number, number> };
const stats = new Map<string, Stat>(ROUTES.map((r) => [r, { times: [], errors: 0, statuses: new Map() }]));
const deadline = Date.now() + SECONDS * 1000;
let next = 0;

async function user() {
  while (Date.now() < deadline) {
    const url = ROUTES[next++ % ROUTES.length]!;
    const s = stats.get(url)!;
    const t0 = performance.now();
    try {
      const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      await res.arrayBuffer(); // the whole page, like a browser
      s.times.push(performance.now() - t0);
      s.statuses.set(res.status, (s.statuses.get(res.status) ?? 0) + 1);
      if (res.status >= 400) s.errors += 1; // 3xx (e.g. a locale redirect) is fine
    } catch {
      s.times.push(performance.now() - t0);
      s.errors += 1;
    }
  }
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]! : 0);
console.log(`Load test: ${USERS} users for ${SECONDS}s on ${ROUTES.length} pages${bypass ? " (protection bypass on)" : ""}…`);
await Promise.all(Array.from({ length: USERS }, user));

let failed = false;
let total = 0;
console.log("\npage                                         reqs   err%    p50    p95    p99  statuses");
for (const [url, s] of stats) {
  const sorted = [...s.times].sort((a, b) => a - b);
  const n = sorted.length;
  total += n;
  const errPct = n ? (100 * s.errors) / n : 100;
  const p95 = pct(sorted, 95);
  const ok = n > 0 && errPct < 1 && p95 < 1500;
  if (!ok) failed = true;
  const path = url.replace(/^https?:\/\/[^/]+/, "") || "/";
  const host = url.startsWith(family) ? "family" : "store";
  const st = [...s.statuses].map(([c, k]) => `${c}×${k}`).join(" ");
  console.log(
    `${ok ? "PASS" : "FAIL"} ${`${host} ${path}`.padEnd(40)} ${String(n).padStart(5)} ${errPct.toFixed(1).padStart(6)} ${pct(sorted, 50).toFixed(0).padStart(6)} ${p95.toFixed(0).padStart(6)} ${pct(sorted, 99).toFixed(0).padStart(6)}  ${st}`,
  );
}
console.log(`\n${total} requests, ${(total / SECONDS).toFixed(1)} per second. Pass = error rate < 1% and p95 < 1500 ms per page.`);
process.exit(failed ? 1 : 0);
