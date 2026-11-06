/**
 * Deed catalog (preset good deeds). SERVER-ONLY.
 * Admin side (Phase 3 slice 4): create, edit, turn on/off, reorder, starter set. Callers check
 * the admin role first. Every change + its audit row run in ONE transaction.
 * Family side (Phase 4) reads ACTIVE types in display order: listDeedTypes({ activeOnly: true }).
 * No delete on purpose: submitted deeds point at their type; retired types are turned off.
 */
import "server-only";
import { AuditLog, connectDb, DeedType, ensureLock, takeLock, withTransaction, type AuditAction, type DbSession } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import type { DeedTypeInput } from "./schemas.ts";

/** Spanish when asked for and present (non-empty), else English. One helper for every page. */
export function localized(text: { en?: string | null; es?: string | null } | undefined, locale: string): string | undefined {
  const es = text?.es?.trim();
  const en = text?.en?.trim();
  return (locale === "es" && es ? es : en) || undefined;
}

export type DeedTypeRow = {
  id: string;
  title: { en: string; es?: string };
  description: { en?: string; es?: string };
  tipMinCents?: number;
  tipMaxCents?: number;
  active: boolean;
  sortOrder: number;
  /** ISO time of the last save: the edit form sends it back (compare-and-set). */
  version: string;
};

type Raw = {
  _id: unknown;
  title?: { en?: string; es?: string | null } | null;
  description?: { en?: string | null; es?: string | null } | null;
  recommendedTipCents?: { min?: number | null; max?: number | null } | null;
  active?: boolean | null;
  sortOrder?: number | null;
  updatedAt?: Date | null;
};

function toRow(d: Raw): DeedTypeRow {
  return {
    id: String(d._id),
    title: { en: d.title?.en ?? "", es: d.title?.es || undefined },
    description: { en: d.description?.en || undefined, es: d.description?.es || undefined },
    tipMinCents: d.recommendedTipCents?.min ?? undefined,
    tipMaxCents: d.recommendedTipCents?.max ?? undefined,
    active: d.active !== false,
    sortOrder: d.sortOrder ?? 0,
    version: d.updatedAt ? new Date(d.updatedAt).toISOString() : "",
  };
}

/** Display order: sortOrder, then oldest first (stable for ties). */
export async function listDeedTypes({ activeOnly = false }: { activeOnly?: boolean } = {}): Promise<DeedTypeRow[]> {
  await connectDb();
  const docs = await DeedType.find(activeOnly ? { active: true } : {}).sort({ sortOrder: 1, createdAt: 1 }).limit(500).lean<Raw[]>();
  return docs.map(toRow);
}

export async function getDeedType(rawId: string): Promise<DeedTypeRow | null> {
  const id = normalizeObjectId(rawId);
  if (!id) return null;
  await connectDb();
  const d = await DeedType.findById(id).lean<Raw>();
  return d ? toRow(d) : null;
}

export type CatalogResult = { ok: true; id?: string } | { ok: false; error: "notFound" | "changed" | "notEmpty" };

/**
 * Every catalog change that depends on the whole list takes this lock first (see
 * packages/db/src/models/lock.ts): concurrent creates/moves/seeding take turns, so the starter
 * set can't be added twice and new deeds can't get the same position (review 2026-11-05).
 */
const LOCK = "deed-catalog";

async function locked<T>(fn: (session: DbSession) => Promise<T>): Promise<T> {
  await connectDb();
  await ensureLock(LOCK);
  return withTransaction(async (session) => {
    await takeLock(LOCK, session);
    return fn(session);
  });
}

async function audit(adminId: string, action: AuditAction, id: unknown, details: Record<string, unknown>, session: DbSession) {
  await AuditLog.create([{ actorUserId: adminId, action, targetType: "deed_type", targetId: String(id), details }], { session });
}

/** The stored shape of a validated form (blank optional text/amounts -> absent). */
function docFields(input: DeedTypeInput) {
  return {
    title: { en: input.titleEn, es: input.titleEs },
    description: { en: input.descriptionEn || undefined, es: input.descriptionEs || undefined },
    recommendedTipCents: { min: input.tipMin, max: input.tipMax },
  };
}

/** $set/$unset for an edit (Mongoose drops undefined from $set, so blanks must be $unset). */
function updateOps(input: DeedTypeInput) {
  const set: Record<string, unknown> = { "title.en": input.titleEn, "title.es": input.titleEs };
  const unset: Record<string, 1> = {};
  const opt = (path: string, v: string | number | undefined) => (v === undefined || v === "" ? (unset[path] = 1) : (set[path] = v));
  opt("description.en", input.descriptionEn);
  opt("description.es", input.descriptionEs);
  opt("recommendedTipCents.min", input.tipMin);
  opt("recommendedTipCents.max", input.tipMax);
  return { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) };
}

/** New deed at the END of the list. */
export async function createDeedType(adminId: string, input: DeedTypeInput): Promise<CatalogResult> {
  return locked(async (session) => {
    const last = await DeedType.findOne().sort({ sortOrder: -1 }).select("sortOrder").session(session).lean<Raw>();
    const [doc] = await DeedType.create([{ ...docFields(input), active: true, sortOrder: (last?.sortOrder ?? 0) + 10 }], { session });
    await audit(adminId, "deed_type.create", doc!._id, { to: docFields(input) }, session);
    return { ok: true, id: String(doc!._id) } as const;
  });
}

/**
 * Edit. `version` = the deed's updatedAt (ISO) when the form was opened: if someone saved in
 * between, nothing is overwritten and the admin gets "changed" (review 2026-11-05).
 */
export async function updateDeedType(adminId: string, rawId: string, input: DeedTypeInput, version: string): Promise<CatalogResult> {
  const id = normalizeObjectId(rawId);
  const at = new Date(version);
  if (!id) return { ok: false, error: "notFound" };
  if (Number.isNaN(at.getTime())) return { ok: false, error: "changed" };
  await connectDb();
  return withTransaction(async (session) => {
    const before = await DeedType.findById(id).session(session).lean<Raw>();
    if (!before) return { ok: false, error: "notFound" } as const;
    const res = await DeedType.updateOne({ _id: id, updatedAt: at }, updateOps(input), { session, runValidators: true });
    if (res.matchedCount !== 1) return { ok: false, error: "changed" } as const;
    // Full before/after (descriptions included) so every visible change is attributable.
    await audit(adminId, "deed_type.update", id, { from: toRow(before), to: docFields(input) }, session);
    return { ok: true, id } as const;
  });
}

/** Show to / hide from families. Compare-and-set on the current value. */
export async function setDeedTypeActive(adminId: string, rawId: string, active: boolean): Promise<CatalogResult> {
  const id = normalizeObjectId(rawId);
  if (!id) return { ok: false, error: "notFound" };
  await connectDb();
  return withTransaction(async (session) => {
    const res = await DeedType.updateOne({ _id: id, active: !active }, { $set: { active } }, { session });
    if (res.matchedCount !== 1) {
      const exists = await DeedType.exists({ _id: id }).session(session);
      return { ok: false, error: exists ? "changed" : "notFound" } as const;
    }
    await audit(adminId, active ? "deed_type.activate" : "deed_type.deactivate", id, {}, session);
    return { ok: true, id } as const;
  });
}

/**
 * Move one place up or down: swap positions with the neighbour (2 writes). Only if old data has
 * TIED positions is the whole list renumbered (10, 20, 30, ...), so a move can never do nothing.
 */
export async function moveDeedType(adminId: string, rawId: string, direction: "up" | "down"): Promise<CatalogResult> {
  const id = normalizeObjectId(rawId);
  if (!id) return { ok: false, error: "notFound" };
  return locked(async (session) => {
    const all = await DeedType.find().sort({ sortOrder: 1, createdAt: 1 }).select("_id sortOrder").limit(500).session(session).lean<Raw[]>();
    const i = all.findIndex((d) => String(d._id) === id);
    if (i < 0) return { ok: false, error: "notFound" } as const;
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return { ok: true, id } as const; // already first/last
    const a = all[i]!;
    const b = all[j]!;
    if ((a.sortOrder ?? 0) !== (b.sortOrder ?? 0)) {
      await DeedType.bulkWrite(
        [
          { updateOne: { filter: { _id: a._id }, update: { $set: { sortOrder: b.sortOrder ?? 0 } } } },
          { updateOne: { filter: { _id: b._id }, update: { $set: { sortOrder: a.sortOrder ?? 0 } } } },
        ],
        { session },
      );
    } else {
      const order = all.map((d) => String(d._id));
      [order[i], order[j]] = [order[j]!, order[i]!];
      await DeedType.bulkWrite(
        order.map((docId, n) => ({ updateOne: { filter: { _id: docId }, update: { $set: { sortOrder: (n + 1) * 10 } } } })),
        { session },
      );
    }
    await audit(adminId, "deed_type.reorder", id, { direction }, session);
    return { ok: true, id } as const;
  });
}

/**
 * Suggested starter deeds (EN + ES). Only while the catalog is EMPTY, so it can never duplicate
 * or overwrite the admin's own list. Admins edit or turn off any of them afterwards.
 */
export const STARTER_DEEDS: { en: string; es: string; min: number; max: number }[] = [
  { en: "Raked leaves for a neighbor", es: "Rastrillé las hojas de un vecino", min: 500, max: 1500 },
  { en: "Shoveled snow for someone", es: "Paleé la nieve para alguien", min: 500, max: 2000 },
  { en: "Read a story to someone", es: "Le leí un cuento a alguien", min: 200, max: 1000 },
  { en: "Helped carry groceries", es: "Ayudé a cargar las compras", min: 200, max: 1000 },
  { en: "Visited or made a card for an older neighbor", es: "Visité o le hice una tarjeta a un vecino mayor", min: 200, max: 1000 },
  { en: "Picked up litter", es: "Recogí basura", min: 200, max: 1000 },
  { en: "Helped at a food pantry or community event", es: "Ayudé en un banco de alimentos o un evento comunitario", min: 500, max: 2500 },
  { en: "Donated toys or clothes", es: "Doné juguetes o ropa", min: 200, max: 1000 },
];

export async function seedStarterDeeds(adminId: string): Promise<CatalogResult> {
  // Under the catalog lock: two clicks at once can't both see "empty" and both insert.
  return locked(async (session) => {
    if ((await DeedType.countDocuments().session(session)) > 0) return { ok: false, error: "notEmpty" } as const;
    const docs = await DeedType.insertMany(
      STARTER_DEEDS.map((d, n) => ({ title: { en: d.en, es: d.es }, recommendedTipCents: { min: d.min, max: d.max }, active: true, sortOrder: (n + 1) * 10 })),
      { session },
    );
    await audit(adminId, "deed_type.seed", docs[0]!._id, { count: docs.length }, session);
    return { ok: true } as const;
  });
}
