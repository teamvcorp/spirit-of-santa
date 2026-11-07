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

/** The parent's own family id, or null (no family, the session's family isn't theirs, or it is being deleted). */
export async function ownFamilyId(parent: Parent): Promise<string | null> {
  const fid = normalizeObjectId(parent.familyId);
  if (!fid) return null;
  await connectDb();
  // A family whose account is being deleted ("deliver, then delete") is refused by EVERY family action, even
  // from a session that hasn't noticed yet (sessions re-check the user only every 5 minutes): one rule here.
  const fam = await Family.exists({ _id: fid, ownerUserId: parent.id, deletionRequestedAt: null });
  return fam ? fid : null;
}
