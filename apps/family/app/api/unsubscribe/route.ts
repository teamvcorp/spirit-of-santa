/**
 * POST /api/unsubscribe?t=<signed token>: RFC 8058 "one-click" unsubscribe, called by mail
 * providers (Gmail/Yahoo "Unsubscribe" button) from the List-Unsubscribe header (Phase 7).
 * No sign-in by design; the signed token can only switch ONE kind of email OFF for ONE family
 * (@repo/families/notifications). GET does nothing here (link scanners prefetch with GET): people
 * use the confirmation PAGE /unsubscribe instead.
 */
import { unsubscribe, unsubscribeTokenSchema } from "@repo/families/notifications";

export async function POST(request: Request): Promise<Response> {
  const t = unsubscribeTokenSchema.safeParse(new URL(request.url).searchParams.get("t"));
  const kind = t.success ? await unsubscribe(t.data) : null;
  // 200 either way would hide bad links from the provider; 400 tells it the link is invalid.
  return new Response(null, { status: kind ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}

export function GET(): Response {
  return new Response("Use the link in the email to open the unsubscribe page.", { status: 405, headers: { Allow: "POST" } });
}
