/**
 * GET /api/cron/purge-signups: daily cleanup of unconfirmed sign-ups (> 48 h old): store owners
 * AND parents (one shared database, so the family app needs no cron or CRON_SECRET of its own).
 * Called by Vercel Cron (schedule in apps/store/vercel.json), which sends
 * `Authorization: Bearer <CRON_SECRET>`. Set CRON_SECRET (a long random string) in the
 * store project's Vercel env; anyone without it gets 401.
 */
import { timingSafeEqual } from "node:crypto";
import { purgeUnverifiedParentSignups, purgeUnverifiedStoreSignups } from "@repo/auth/account-flows";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  // Constant-time compare; refuse entirely if no secret is configured.
  if (!secret || secret.length < 16 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Independent jobs: one failing must not skip the other (review 2026-11-05).
  const [stores, parents] = await Promise.allSettled([purgeUnverifiedStoreSignups(), purgeUnverifiedParentSignups()]);
  const result = {
    stores: stores.status === "fulfilled" ? stores.value : "failed",
    parents: parents.status === "fulfilled" ? parents.value : "failed",
  };
  if (stores.status === "rejected" || parents.status === "rejected") {
    console.error("[cron] purge-signups partly failed", result);
    return Response.json(result, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  console.info("[cron] purge-signups", result); // counts only
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}