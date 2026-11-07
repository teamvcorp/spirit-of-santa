/**
 * GET /parent/our-data/download (Phase 8 slice 2b): the family's data as a JSON file (COPPA review right + a copy
 * to keep). Same checks as the page: signed-in parent AND PIN unlocked. Never cached anywhere (no-store), and
 * no-referrer so the download link never leaks.
 */
import { familyDataExport } from "@repo/families/data-export";
import { unlockedParentOrNull } from "@/lib/parent";

export async function GET(_req: Request, ctx: { params: Promise<{ locale: string }> }) {
  const parent = await unlockedParentOrNull();
  if (!parent) return new Response("PIN required", { status: 403, headers: { "Cache-Control": "no-store" } });
  const { locale } = await ctx.params;
  const data = await familyDataExport(parent, locale === "es" ? "es" : "en");
  if (!data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const day = data.exportedAt.toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="spirit-of-santa-family-data-${day}.json"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
