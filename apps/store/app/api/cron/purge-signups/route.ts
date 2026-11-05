/**
 * GET /api/cron/purge-signups: daily cleanup of unconfirmed store sign-ups (> 48 h old).
 * Called by Vercel Cron (schedule in apps/store/vercel.json), which sends
 * `Authorization: Bearer <CRON_SECRET>`. Set CRON_SECRET (a long random string) in the
 * store project's Vercel env; anyone without it gets 401.
 */
import { timingSafeEqual } from "node:crypto";
import { purgeUnverifiedStoreSignups } from "@repo/auth/account-flows";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  // Constant-time compare; refuse entirely if no secret is configured.
  if (!secret || secret.length < 16 || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await purgeUnverifiedStoreSignups();
  console.info("[cron] purge-signups", result); // counts only
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}