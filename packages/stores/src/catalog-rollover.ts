/**
 * Jan 1 catalogue carry-over (year-round slice 7, owner 2026-11-07: "copy them over"). SERVER-ONLY.
 *
 * Stores may add and change items only Jan 1 – Mar 31. So the new season doesn't start with an EMPTY catalogue
 * (kids could browse nothing until stores re-entered everything), the daily money job copies every ACTIVE item
 * of last season's approved / pending stores into the new season: name, description, category, photo, price
 * and the stock left. Stores then review and adjust them in their window. Drafts and archived items are not
 * copied; neither is payoutCents (fixed when a gift is funded, from the store's discount at that time).
 *
 * Safety:
 *  - Runs only during the calendar Q1 window (never in November on a first deploy, which would copy test data).
 *  - Idempotent: each copy is an UPSERT keyed by `copiedFromItemId` (unique index), so a retried or concurrent
 *    run can't duplicate an item; `Season.catalogCopiedAt` then marks the season done (later runs skip at once).
 *  - Copies share the photo blob with last season's item: items.ts deletes a blob only when no item uses it.
 */
import "server-only";
import { connectDb, Item, Season, Store, trusted } from "@repo/db";
import { isStoreItemWindowOpen } from "@repo/lib/season";
import { getSeasonState } from "./season.ts";

const BATCH = 500;

export type CatalogRolloverResult =
  | { status: "notQ1" | "alreadyDone"; year: number }
  | { status: "done"; year: number; copied: number; sourceItems: number };

type SourceItem = {
  _id: unknown;
  storeId: unknown;
  name: string;
  description?: string;
  category?: string;
  photo?: { url?: string; pathname?: string } | null;
  priceCents: number;
  inventory?: number;
};

export async function copyLastSeasonCatalog(now = new Date()): Promise<CatalogRolloverResult> {
  await connectDb();
  const { year } = await getSeasonState(now);
  // The CALENDAR window (not the admin override): copying is a season-start job, not a store-editing switch.
  if (!isStoreItemWindowOpen(now)) return { status: "notQ1", year };
  const season = await Season.findOne({ year }).select("catalogCopiedAt").lean<{ catalogCopiedAt?: Date | null }>();
  if (season?.catalogCopiedAt) return { status: "alreadyDone", year };

  // Only stores that may still sell (approved or awaiting approval); rejected / suspended stores' items stay behind.
  const storeIds = ((await Store.find({ status: trusted({ $in: ["approved", "pending"] }) }).distinct("_id")) as unknown[]).map(String);
  let copied = 0;
  let sourceItems = 0;
  let after: string | null = null;
  for (;;) {
    const filter = {
      seasonYear: year - 1,
      status: "active" as const,
      priceCents: trusted({ $gte: 1 }),
      storeId: trusted({ $in: storeIds }),
      ...(after ? { _id: trusted({ $gt: after }) } : {}),
    };
    const page: SourceItem[] = await Item.find(filter)
      .sort({ _id: 1 })
      .limit(BATCH)
      .select("storeId name description category photo priceCents inventory")
      .lean<SourceItem[]>();
    if (page.length === 0) break;
    sourceItems += page.length;
    const ops = page.map((src) => ({
        updateOne: {
          // Keyed by the source item: a second run (or two at once) finds the existing copy and inserts nothing.
          filter: { copiedFromItemId: src._id },
          update: {
            $setOnInsert: {
              storeId: src.storeId,
              seasonYear: year,
              name: src.name,
              ...(src.description ? { description: src.description } : {}),
              ...(src.category ? { category: src.category } : {}),
              ...(src.photo?.url ? { photo: { url: src.photo.url, pathname: src.photo.pathname } } : {}),
              priceCents: src.priceCents,
              inventory: Math.max(0, src.inventory ?? 0),
              status: "active",
              stats: { views: 0 },
            },
          },
          upsert: true,
        },
      }));
    const res = await Item.bulkWrite(ops as Parameters<typeof Item.bulkWrite>[0], { ordered: false });
    copied += res.upsertedCount;
    after = String(page[page.length - 1]!._id);
    if (page.length < BATCH) break;
  }
  await Season.updateOne({ year }, { $set: { catalogCopiedAt: now } }, { upsert: true });
  return { status: "done", year, copied, sourceItems };
}
