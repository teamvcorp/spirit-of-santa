/**
 * Shared loader for dashboard pages. SERVER-ONLY. Call inside <Suspense> (it reads the
 * session, which is request-time data under Cache Components).
 *  - Not signed in → redirected to /signin (requireRole).
 *  - Signed in but no longer on this store (e.g. a rep just removed) → store is null; pages
 *    show a "no access" message. Membership is checked in the DB, not just the session.
 */
import "server-only";
import { connection } from "next/server";
import { requireRole } from "@repo/auth";
import { memberStore } from "@repo/stores/owner";
import { authOptions } from "@/auth";

export async function loadMember() {
  await connection(); // next-auth makes random CSRF bytes: never during prerender
  const user = await requireRole(authOptions, "store_owner", "store_rep");
  const store = await memberStore({ id: user.id, role: user.role, storeId: user.storeId });
  return { user, store, isOwner: user.role === "store_owner" };
}

/** Same list as the server gates (re-exported so pages keep one import). */
export { isStoreEditable } from "@repo/lib/store";