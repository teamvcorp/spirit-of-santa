/**
 * Item engagement: recording views (family app, Phase 6) and reading totals (store dashboard).
 * SERVER-ONLY. Maths and the status lists live in engagement-math.ts (pure, unit-tested).
 *
 * Privacy (kids are minors; COPPA): nothing here stores who viewed or listed what.
 *  - Views: one counter per item. "Once per visitor per day" uses a keyed hash of the signed-in
 *    family id (or, signed out, the IP's network) as a RateLimit key that deletes itself after
 *    the day ends. The hash can't be reversed without the server secret.
 *  - Wish lists: only aggregate totals per item ever leave this module.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { sessionPurposeKey } from "@repo/auth/purpose-key";
import type { Types } from "mongoose";
import { connectDb, Item, Store, WishListItem } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { getSeasonYear } from "@repo/lib/season";
import { hitRateLimit, ipKey } from "@repo/auth/rate-limit";
import { EMPTY_TOTALS, FUNDED_STATUSES, LOCKED_STATUSES, ON_LIST_STATUSES, type WishListTotals } from "./engagement-math.ts";

/** Most views one visitor can add across ALL items per day (blunts scripted inflation). */
export const MAX_COUNTED_VIEWS_PER_VISITOR_PER_DAY = 300;
const DAY_SECONDS = 86_400;

/** Who is viewing. familyId when a family is signed in, otherwise the request IP. */
export type Viewer = { familyId?: string; ip: string };

/**
 * Non-reversible, per-deployment key for a viewer (never stored in clear). The HMAC key is
 * DERIVED from NEXTAUTH_SECRET with HKDF under its own label (same pattern as
 * packages/auth/src/unlock-token.ts), so the session-signing key itself is never reused.
 * Known limits (accepted, review 2026-11-05): "day" = UTC day (fixed rate-limit windows), and
 * one household browsing signed out then signed in counts as two viewers.
 */
function viewerKey(v: Viewer): string {
  const key = sessionPurposeKey("sos/item-view/v1");
  const who = v.familyId ? `family:${v.familyId}` : `ip:${ipKey(v.ip)}`;
  return createHmac("sha256", key).update(who).digest("base64url").slice(0, 32);
}

/**
 * Count a family opening an item's page. Call from the family app's item page (Phase 6),
 * AFTER the page has decided to show the item. Returns true if this view was counted.
 * Only counts active items of APPROVED stores in the current season, once per viewer per
 * item per day. Never throws for bad input: a broken counter must not break the page.
 */
export async function recordItemView(rawItemId: string, viewer: Viewer): Promise<boolean> {
  const itemId = normalizeObjectId(rawItemId);
  if (!itemId) return false;
  try {
    return await countView(itemId, viewer);
  } catch (err) {
    // Keep the promise in the doc comment: a counter failure must never fail the family's page.
    // Log the error TYPE only (messages can contain connection details).
    console.error("[engagement] view not counted:", err instanceof Error ? err.name : "unknown");
    return false;
  }
}

async function countView(itemId: string, viewer: Viewer): Promise<boolean> {
  await connectDb();
  const item = await Item.findOne({ _id: itemId, seasonYear: getSeasonYear(), status: "active" }).select("storeId").lean();
  if (!item) return false;
  if (!(await Store.exists({ _id: item.storeId, status: "approved" }))) return false;
  const who = viewerKey(viewer);
  // Dedupe first (a repeat view costs nothing from the daily cap), then the per-viewer cap.
  if (!(await hitRateLimit(`view:${itemId}:${who}`, 1, DAY_SECONDS))) return false;
  if (!(await hitRateLimit(`view-cap:${who}`, MAX_COUNTED_VIEWS_PER_VISITOR_PER_DAY, DAY_SECONDS))) return false;
  // timestamps: false: a family viewing an item is not an edit (updatedAt means "last edited").
  await Item.updateOne({ _id: itemId }, { $inc: { "stats.views": 1 } }, { timestamps: false });
  return true;
}

/**
 * Wish-list totals per item for ONE store and season (optionally one item), keyed by item id.
 * Items nobody has listed are absent from the map: use EMPTY_TOTALS for them.
 * `storeId` must come from memberStore() (the caller's own store), never from user input.
 */
export async function wishListTotals(storeId: Types.ObjectId, seasonYear: number, itemId?: Types.ObjectId): Promise<Map<string, WishListTotals>> {
  // ObjectId types (not string/unknown) so a URL string or request object can't be passed in by
  // mistake: aggregations skip sanitizeFilter, so an object like {$ne: null} would match every store.
  await connectDb();
  // Aggregation pipelines aren't cast or sanitised by Mongoose: every value here is ours
  // (an ObjectId from the DB, a number, and constant status lists), never request input.
  const rows = await WishListItem.aggregate<{ _id: unknown } & WishListTotals>([
    { $match: { storeId, seasonYear, status: { $in: [...ON_LIST_STATUSES] }, ...(itemId ? { itemId } : {}) } },
    {
      $group: {
        _id: "$itemId",
        onLists: { $sum: 1 },
        fullyFunded: { $sum: { $cond: [{ $in: ["$status", [...FUNDED_STATUSES]] }, 1, 0] } },
        locked: { $sum: { $cond: [{ $in: ["$status", [...LOCKED_STATUSES]] }, 1, 0] } },
        fundedCentipoints: { $sum: "$fundedCentipoints" },
        costCentipoints: { $sum: "$costCentipoints" },
      },
    },
  ]);
  return new Map(rows.map(({ _id, ...t }) => [String(_id), { ...EMPTY_TOTALS, ...t }]));
}
