/**
 * Admin dashboard numbers (Phase 3 slice 5). SERVER-ONLY. Admin-only callers.
 * Totals only, every query bounded/indexed. Points, revenue and completed deeds are added when
 * Phases 4–5 create that data (no fake zeros before then).
 */
import "server-only";
import { AuditLog, connectDb, DeedType, Item, trusted, User, WishListItem } from "@repo/db";
import { getSeasonYear } from "@repo/lib/season";
import { countPendingTexts } from "@repo/deeds/moderation";
import { getSeasonState } from "@repo/stores/season";
import { storeStatusCounts } from "@repo/stores/queries";

const countBy = async <K extends string>(rows: Promise<{ _id: K; n: number }[]>) =>
  Object.fromEntries((await rows).map((r) => [r._id, r.n])) as Partial<Record<K, number>>;

export async function dashboardStats() {
  await connectDb();
  const year = getSeasonYear(); // no DB trip needed for the year: season state runs in parallel
  const [season, stores, items, roles, statuses, deeds, views, onLists, activity, pendingTexts] = await Promise.all([
    getSeasonState(),
    storeStatusCounts(),
    countBy(Item.aggregate<{ _id: string; n: number }>([{ $match: { seasonYear: year } }, { $group: { _id: "$status", n: { $sum: 1 } } }])),
    countBy(User.aggregate<{ _id: string; n: number }>([{ $match: { status: "active" } }, { $group: { _id: "$role", n: { $sum: 1 } } }])),
    countBy(User.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }])),
    DeedType.countDocuments({ active: true }),
    Item.aggregate<{ n: number }>([{ $match: { seasonYear: year } }, { $group: { _id: null, n: { $sum: "$stats.views" } } }]),
    WishListItem.countDocuments({ seasonYear: year, status: trusted({ $ne: "removed" }) }),
    AuditLog.find().sort({ createdAt: -1 }).limit(15).select("action actorUserId createdAt").lean(),
    countPendingTexts(),
  ]);
  // Who did each recent action (emails of at most 15 accounts).
  // System rows (daily jobs, the spend correction) have NO actor: skip them here (shown as "—"). String(undefined)
  // used to reach the query and crash the dashboard (found by the page audit, 2026-11-07).
  const actorIds = [...new Set(activity.filter((a) => a.actorUserId != null).map((a) => String(a.actorUserId)))];
  const actors = await User.find({ _id: trusted({ $in: actorIds }) }).select("email").lean();
  const emailOf = new Map(actors.map((u) => [String(u._id), u.email]));
  return {
    season,
    stores,
    items: { active: items.active ?? 0, draft: items.draft ?? 0 },
    users: {
      parent: roles.parent ?? 0,
      store_owner: roles.store_owner ?? 0,
      store_rep: roles.store_rep ?? 0,
      admin: roles.admin ?? 0,
      pending: statuses.pending ?? 0,
      suspended: statuses.suspended ?? 0,
    },
    deeds,
    pendingTexts,
    views: views[0]?.n ?? 0,
    onLists,
    activity: activity.map((a) => ({ action: a.action, at: a.createdAt, by: emailOf.get(String(a.actorUserId)) ?? "—" })),
  };
}
