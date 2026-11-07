/**
 * Which child a family-app path belongs to (client-safe). The ONE place that knows the kid routes
 * (/kids/<id>, /kids/<id>/gifts…), used by the tab bar.
 */
import { OBJECT_ID_PATTERN } from "@repo/lib/ids";

const KID = new RegExp(`^/kids/(${OBJECT_ID_PATTERN})(/.*)?$`);

export function kidPath(path: string): { kidId: string; section: "wishlist" | "gifts" } | null {
  const m = KID.exec(path);
  if (!m) return null;
  return { kidId: m[1]!, section: m[2]?.startsWith("/gifts") ? "gifts" : "wishlist" };
}
