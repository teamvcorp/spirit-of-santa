/**
 * "Is this signed-in parent the owner of this family?" SERVER-ONLY. THE single rule, used by
 * @repo/families, @repo/deeds and @repo/wishlists (moved here 2026-11-06 so wishlists can use it
 * without a dependency cycle: families → payments → wishlists).
 */
import "server-only";
import { connectDb, Family } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";

/** A signed-in parent as the apps pass it around (from the session). */
export type Parent = { id: string; familyId?: string };

/** The parent's own family id, or null (no family, or the session's family isn't theirs). */
export async function ownFamilyId(parent: Parent): Promise<string | null> {
  const fid = normalizeObjectId(parent.familyId);
  if (!fid) return null;
  await connectDb();
  const fam = await Family.exists({ _id: fid, ownerUserId: parent.id });
  return fam ? fid : null;
}
