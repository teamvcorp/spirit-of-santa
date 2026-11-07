/**
 * Jan 1 catalogue carry-over (year-round slice 7, owner 2026-11-07: "copy them over"). SERVER-ONLY.
 *
 * Stores may add and change items only Jan 1 – Mar 31. So the new season doesn't start with an EMPTY catalogue
 * (kids could browse nothing until stores re-entered everything), the daily money job copies every ACTIVE, priced
 * item of last season into the new season for each approved / pending store: name, description, category, photo,
 * price and the stock left. Stores then review and adjust them in their window. Drafts and archived items are not
 * copied; neither is payoutCents (fixed when a gift is funded, from the store's discount at that time).
 *
 * Rules (review 2026-11-07):
 *  - Only in the calendar Q1 window, and never while an admin has CLOSED the store window (stores couldn't fix
 *    or archive the copies then).
 *  - PER STORE, in one transaction that takes the SAME store lock as createItem/restoreItem (itemLockSeq): a store
 *    that already entered its own items this season is SKIPPED (a late run never duplicates them or pushes the
 *    store past STORE_ITEM_LIMIT); a concurrent add waits for the copy and then counts it.
 *  - Store.catalogCopiedYear marks each store done, so a store approved or reinstated later in Q1 is still copied
 *    on a later run, and finished stores cost nothing on later runs.
 *  - Idempotent twice over: the store marker, and each copy is an UPSERT keyed by `copiedFromItemId` (unique
 *    index). It REFUSES to run without that index (prod has autoIndex off: run db:sync-indexes after deploy).
 *  - Time budget: stores left over continue on the next daily run (`remaining`), so the money job's later steps
 *    always get their turn (it also runs LAST in the money job).
 *  - Copies share the photo blob with last season's item: items.ts deletes a blob only when no item uses it.
 */
import "server-only";
import { connectDb, Item, Store, trusted, withTransaction } from "@repo/db";
import { STORE_ITEM_LIMIT } from "@repo/lib/limits";
import { isStoreItemWindowOpen } from "@repo/lib/season";
import { getSeasonState } from "./season.ts";

/** Mongoose's default name for itemSchema.index({ copiedFromItemId: 1 }). */
const COPY_INDEX = "copiedFromItemId_1";
const TIME_BUDGET_MS = 60_000;
const STORE_PAGE = 2000;

export type CatalogRolloverResult =
  | { status: "notQ1" | "windowClosed"; year: number }
  | { status: "done"; year: number; stores: number; copied: number; skippedOwnItems: number; remaining: number };

type SourceItem = {
  _id: unknown;
  name: string;
  description?: string;
  category?: string;
  photo?: { url?: string; pathname?: string } | null;
  priceCents: number;
  inventory?: number;
};

export async function copyLastSeasonCatalog(now = new Date(), opts: { timeBudgetMs?: number } = {}): Promise<CatalogRolloverResult> {
  await connectDb();
  const s = await getSeasonState(now);
  const year = s.year;
  // The CALENDAR window: copying is a season-start job. An admin "closed" switch still wins (see the header).
  if (!isStoreItemWindowOpen(now)) return { status: "notQ1", year };
  if (s.storeWindowMode === "closed") return { status: "windowClosed", year };
  if (!(await Item.collection.indexExists(COPY_INDEX))) throw new Error(`Item index ${COPY_INDEX} missing: run db:sync-indexes before the Jan 1 copy`);

  const stores = await Store.find({ status: trusted({ $in: ["approved", "pending"] }), catalogCopiedYear: trusted({ $ne: year }) })
    .select("_id")
    .sort({ _id: 1 })
    .limit(STORE_PAGE)
    .lean<{ _id: unknown }[]>();
  const started = Date.now();
  const out = { status: "done" as const, year, stores: 0, copied: 0, skippedOwnItems: 0, remaining: 0 };
  for (let i = 0; i < stores.length; i++) {
    if (Date.now() - started > (opts.timeBudgetMs ?? TIME_BUDGET_MS)) {
      out.remaining = stores.length - i; // next daily run continues
      break;
    }
    const storeId = String(stores[i]!._id);
    // Counted only AFTER the commit (a retried transaction callback must not count twice).
    const r = await withTransaction(async (session) => {
      // The store's item lock (same as createItem/restoreItem): a concurrent add waits, then counts the copies.
      await Store.updateOne({ _id: storeId }, { $inc: { itemLockSeq: 1 } }, { session });
      const own = await Item.countDocuments({ storeId, seasonYear: year, status: trusted({ $ne: "archived" }), copiedFromItemId: trusted({ $exists: false }) }).session(session);
      let inserted = 0;
      if (own === 0) {
        const src = await Item.find({ storeId, seasonYear: year - 1, status: "active", priceCents: trusted({ $gte: 1 }) })
          .sort({ _id: 1 })
          .limit(STORE_ITEM_LIMIT)
          .select("name description category photo priceCents inventory")
          .session(session)
          .lean<SourceItem[]>();
        if (src.length > 0) {
          const ops = src.map((it) => ({
            updateOne: {
              filter: { copiedFromItemId: it._id }, // keyed by the source item: never two copies of one item
              update: {
                $setOnInsert: {
                  storeId,
                  seasonYear: year,
                  name: it.name,
                  ...(it.description ? { description: it.description } : {}),
                  ...(it.category ? { category: it.category } : {}),
                  ...(it.photo?.url ? { photo: { url: it.photo.url, pathname: it.photo.pathname } } : {}),
                  priceCents: it.priceCents,
                  inventory: Math.max(0, it.inventory ?? 0),
                  status: "active",
                  stats: { views: 0 },
                },
              },
              upsert: true,
            },
          }));
          inserted = (await Item.bulkWrite(ops as Parameters<typeof Item.bulkWrite>[0], { session, ordered: false })).upsertedCount;
        }
      }
      await Store.updateOne({ _id: storeId }, { $set: { catalogCopiedYear: year } }, { session });
      return { inserted, skipped: own > 0 };
    });
    out.stores += 1;
    out.copied += r.inserted;
    if (r.skipped) out.skippedOwnItems += 1;
  }
  if (stores.length === STORE_PAGE && out.remaining === 0) out.remaining = 1; // more stores than one page: next run
  return out;
}
