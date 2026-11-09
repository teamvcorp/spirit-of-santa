/**
 * Gift browser + a kid's wish list: READ-ONLY queries for the family app (Phase 6 slice 2).
 * SERVER-ONLY. All writes go through engine.ts (addToList/removeFromList).
 *
 * What a family may see: ACTIVE, priced items of APPROVED stores for THIS season. A store that
 * is pending, suspended or rejected disappears from the browser at once (its items too).
 * Nothing here reveals other families: item pages show stock and price, never who listed it.
 *
 * Security notes (teaching):
 *  - Search text and category come from the URL. They're validated by `giftQuerySchema` (Zod)
 *    and only ever used as plain string VALUES in the pipeline (`$text.$search` and an equality
 *    match), never as keys/operators, so a crafted URL can't inject a Mongo operator.
 *  - Aggregation pipelines are NOT covered by Mongoose's `sanitizeFilter`, which is why the
 *    values are typed strings built here rather than objects copied from input.
 */
import "server-only";
import { z } from "zod";
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";
import { connectDb, Item, Kid, toObjectId, WishListItem } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { itemPriceCentsToCentipoints } from "@repo/lib/points";
import { getSeasonState } from "@repo/stores/season";
import { countsTowardCap, isRemovable, maskSurprise } from "./rules.ts";

export const GIFT_SORTS = ["price_asc", "price_desc", "name", "store"] as const;
export type GiftSort = (typeof GIFT_SORTS)[number];
export const GIFTS_PER_PAGE = 24;
const MAX_PAGE = 100;
const MAX_CATEGORIES = 100;

/** URL search params of the gift browser. Bad values fall back to defaults (never an error page). */
export const giftQuerySchema = z.object({
  q: z.string().trim().max(60).catch(""),
  category: z.string().trim().max(60).catch(""),
  sort: z.enum(GIFT_SORTS).catch("price_asc"),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).catch(1),
});
export type GiftQuery = z.infer<typeof giftQuerySchema>;

/** First value of a search param (Next gives string | string[] | undefined). */
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) ?? undefined;
export function parseGiftQuery(params: Record<string, unknown>): GiftQuery {
  return giftQuerySchema.parse({ q: one(params.q) ?? "", category: one(params.category) ?? "", sort: one(params.sort), page: one(params.page) });
}

export type GiftCard = {
  id: string;
  name: string;
  storeName: string;
  category?: string;
  photoUrl?: string;
  costCentipoints: number;
  soldOut: boolean;
};
export type GiftDetail = GiftCard & { description?: string };

type RawGift = {
  _id: unknown;
  name: string;
  description?: string;
  category?: string;
  photo?: { url?: string } | null;
  priceCents: number;
  inventory?: number | null;
  store: { name: string };
};

const toCard = (g: RawGift): GiftCard => ({
  id: String(g._id),
  name: g.name,
  storeName: g.store.name,
  category: g.category || undefined,
  photoUrl: g.photo?.url || undefined,
  costCentipoints: itemPriceCentsToCentipoints(g.priceCents),
  soldOut: (g.inventory ?? 0) <= 0,
});

/** Pipeline stages: only items whose store is APPROVED (joined, so the store's name comes along). */
const approvedStoreStages = [
  {
    $lookup: {
      from: "stores",
      localField: "storeId",
      foreignField: "_id",
      as: "store",
      pipeline: [{ $match: { status: "approved" } }, { $project: { _id: 0, name: 1 } }],
    },
  },
  { $unwind: "$store" }, // no approved store → the item drops out
];

const SORT_STAGES: Record<GiftSort, Record<string, 1 | -1>> = {
  price_asc: { priceCents: 1, _id: 1 },
  price_desc: { priceCents: -1, _id: 1 },
  name: { name: 1, _id: 1 },
  store: { "store.name": 1, name: 1, _id: 1 },
};

export type GiftPage = { items: GiftCard[]; total: number; page: number; pages: number; categories: string[] };

/** One page of the national gift browser. */
export async function browseGifts(query: GiftQuery, now = new Date()): Promise<GiftPage> {
  await connectDb();
  const { year } = await getSeasonState(now);
  // Independent queries: run together (one round-trip of latency, not two).
  const [first, categories] = await Promise.all([giftPage(query, year), giftCategories(year)]);
  const pages = Math.max(1, Math.ceil(first.total / GIFTS_PER_PAGE));
  // A page past the end (old or edited link) shows the LAST page instead of "no gifts".
  const result = query.page > pages && first.total > 0 ? await giftPage({ ...query, page: pages }, year) : first;
  return { items: result.items, total: result.total, page: Math.min(query.page, pages), pages, categories };
}

async function giftPage(query: GiftQuery, year: number): Promise<{ items: GiftCard[]; total: number }> {
  // $text must be in the FIRST $match (uses the name+description text index from the Item model).
  const match: Record<string, unknown> = { seasonYear: year, status: "active", priceCents: { $gt: 0 } };
  if (query.q) match.$text = { $search: query.q };
  if (query.category) match.category = query.category;

  const [result] = await Item.aggregate<{ rows: RawGift[]; total: { n: number }[] }>([
    { $match: match },
    ...approvedStoreStages,
    {
      $facet: {
        rows: [
          { $sort: SORT_STAGES[query.sort] },
          { $skip: (query.page - 1) * GIFTS_PER_PAGE },
          { $limit: GIFTS_PER_PAGE },
          { $project: { name: 1, category: 1, "photo.url": 1, priceCents: 1, inventory: 1, store: 1 } },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);
  return { items: (result?.rows ?? []).map(toCard), total: result?.total[0]?.n ?? 0 };
}

/** Categories that have at least one visible gift this season (for the filter list). */
async function giftCategories(year: number): Promise<string[]> {
  const rows = await Item.aggregate<{ _id: string }>([
    { $match: { seasonYear: year, status: "active", priceCents: { $gt: 0 }, category: { $nin: [null, ""] } } },
    ...approvedStoreStages,
    { $group: { _id: "$category" } },
    { $sort: { _id: 1 } },
    { $limit: MAX_CATEGORIES },
  ]);
  return rows.map((r) => r._id);
}

/** One gift's page, or null if families may not see it (wrong id, inactive, store not approved). */
export async function giftDetail(rawItemId: string, now = new Date()): Promise<GiftDetail | null> {
  const id = normalizeObjectId(rawItemId);
  if (!id) return null;
  await connectDb();
  const { year } = await getSeasonState(now);
  const [g] = await Item.aggregate<RawGift>([
    { $match: { _id: toObjectId(id), seasonYear: year, status: "active", priceCents: { $gt: 0 } } },
    ...approvedStoreStages,
    { $project: { name: 1, description: 1, category: 1, "photo.url": 1, priceCents: 1, inventory: 1, store: 1 } },
  ]);
  return g ? { ...toCard(g), description: g.description || undefined } : null;
}

export type WishRow = {
  id: string;
  itemId: string;
  name: string;
  storeName: string;
  photoUrl?: string;
  costCentipoints: number;
  fundedCentipoints: number;
  status: string;
  needsSubstitute: boolean;
  /** Parent may remove it now (still collecting magic AND season open). The engine re-checks. */
  removable: boolean;
  /** The gift page still opens (item active, store approved): otherwise show the name without a link. */
  viewable: boolean;
  /** Added by a parent as a surprise (owner 2026-11-08). Unless revealed, name/photo/store/itemId are blank. */
  surprise: boolean;
};

export type KidWishList = { rows: WishRow[]; seasonOpen: boolean; onList: number };

/**
 * A kid's list for THIS season, in funding order (oldest first = the order new points fill it).
 * Scoped to the parent's own family; another family's kid id returns null.
 *
 * SURPRISE gifts are MASKED by default (maskSurprise: no name, photo, store or item id), because the kid pages
 * have no PIN. Only parent-PIN pages pass `{ reveal: true }`. Masking here, on the server, means a surprise never
 * reaches the child's browser, not even hidden in the page data.
 */
export async function kidWishList(
  parent: Parent,
  rawKidId: string,
  now = new Date(),
  { reveal = false }: { reveal?: boolean } = {},
): Promise<KidWishList | null> {
  const kidId = normalizeObjectId(rawKidId);
  const fid = await ownFamilyId(parent);
  if (!kidId || !fid) return null;
  await connectDb();
  if (!(await Kid.exists({ _id: kidId, familyId: fid, archivedAt: null }))) return null;
  const season = await getSeasonState(now);
  const seasonOpen = season.phase === "open";
  const rows = await WishListItem.aggregate<{
    _id: unknown;
    itemId: unknown;
    costCentipoints: number;
    fundedCentipoints: number;
    status: string;
    needsSubstitute?: boolean;
    surprise?: boolean;
    item?: { name: string; status?: string; photo?: { url?: string } | null };
    store?: { name: string; status?: string };
  }>([
    { $match: { kidId: toObjectId(kidId), seasonYear: season.year, status: { $ne: "removed" } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $limit: 100 },
    { $lookup: { from: "items", localField: "itemId", foreignField: "_id", as: "item", pipeline: [{ $project: { _id: 0, name: 1, status: 1, "photo.url": 1 } }] } },
    { $lookup: { from: "stores", localField: "storeId", foreignField: "_id", as: "store", pipeline: [{ $project: { _id: 0, name: 1, status: 1 } }] } },
    { $set: { item: { $first: "$item" }, store: { $first: "$store" } } },
  ]);
  const list = rows.map(
    (w): WishRow => ({
      id: String(w._id),
      itemId: String(w.itemId),
      name: w.item?.name ?? "",
      storeName: w.store?.name ?? "",
      photoUrl: w.item?.photo?.url || undefined,
      costCentipoints: w.costCentipoints,
      fundedCentipoints: w.fundedCentipoints,
      status: w.status,
      needsSubstitute: Boolean(w.needsSubstitute),
      removable: seasonOpen && isRemovable(w.status),
      viewable: w.item?.status === "active" && w.store?.status === "approved",
      surprise: Boolean(w.surprise),
    }),
  ).map((r) => (reveal ? r : maskSurprise(r)));
  return { rows: list, seasonOpen, onList: list.filter((r) => countsTowardCap(r.status)).length };
}
