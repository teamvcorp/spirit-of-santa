/**
 * Kids of a family (parent area of the family app). SERVER-ONLY.
 *
 * Callers MUST pass the signed-in parent (requireRole "parent") AND check the PIN unlock
 * (isParentUnlocked) before any change: kids use the same signed-in device. Every query is
 * scoped to the parent's own family (ownerUserId re-checked in the DB), so a kid id from
 * another family simply isn't found.
 * Audit rows hold ids only, never a child's name (COPPA: no extra copies of personal data).
 * Deleting a kid really deletes their record, deeds, wish-list rows and votes in ONE transaction (COPPA
 * right to deletion). Ledger (Transaction) and Payment rows are financial records: they hold
 * only the kid's id, no name or other personal data, and the ledger is append-only, so they
 * stay (with an id that no longer points at anyone).
 */
import "server-only";
import { AuditLog, ensureLock, Kid, takeLock, withTransaction } from "@repo/db";
import { normalizeObjectId } from "@repo/lib/ids";
import { MAX_KIDS_PER_FAMILY } from "@repo/lib/limits";
import type { KidInput } from "./schemas.ts";

// The ownership rule lives in @repo/auth/family-owner (single source: import it from there).
import { ownFamilyId, type Parent } from "@repo/auth/family-owner";

export type KidRow = {
  id: string;
  firstName: string;
  birthYear: number;
  displayName: string;
  registered: boolean;
  availableCentipoints: number;
  itemCap: number;
};

type Raw = {
  _id: unknown;
  firstName: string;
  birthYear: number;
  displayName: string;
  registration?: { status?: string | null } | null;
  availableCentipoints?: number | null;
  itemCap?: number | null;
};
const toRow = (k: Raw): KidRow => ({
  id: String(k._id),
  firstName: k.firstName,
  birthYear: k.birthYear,
  displayName: k.displayName,
  registered: k.registration?.status === "registered",
  availableCentipoints: k.availableCentipoints ?? 0,
  itemCap: k.itemCap ?? 5,
});


/** Oldest first (stable order on the kid selector). Archived kids are hidden. */
export async function listKids(parent: Parent): Promise<KidRow[]> {
  const fid = await ownFamilyId(parent);
  if (!fid) return [];
  const kids = await Kid.find({ familyId: fid, archivedAt: null }).sort({ createdAt: 1 }).limit(MAX_KIDS_PER_FAMILY).lean<Raw[]>();
  return kids.map(toRow);
}

export async function getKid(parent: Parent, rawId: string): Promise<KidRow | null> {
  const id = normalizeObjectId(rawId);
  const fid = await ownFamilyId(parent);
  if (!id || !fid) return null;
  const k = await Kid.findOne({ _id: id, familyId: fid, archivedAt: null }).lean<Raw>();
  return k ? toRow(k) : null;
}

export type KidResult = { ok: true; id?: string } | { ok: false; error: "notFound" | "limitReached" };

async function audit(parentId: string, action: "kid.add" | "kid.update", kidId: unknown, session: Parameters<Parameters<typeof withTransaction>[0]>[0]) {
  await AuditLog.create([{ actorUserId: parentId, action, targetType: "kid", targetId: String(kidId), details: {} }], { session });
}

/**
 * Add a kid (starts "awaiting registration"). The per-family limit is checked under a family
 * lock, so two adds at once can't pass it (same pattern as the store item limit).
 */
export async function addKid(parent: Parent, input: KidInput): Promise<KidResult> {
  const fid = await ownFamilyId(parent);
  if (!fid) return { ok: false, error: "notFound" };
  const lock = `family-kids:${fid}`;
  await ensureLock(lock);
  return withTransaction(async (session) => {
    await takeLock(lock, session);
    if ((await Kid.countDocuments({ familyId: fid, archivedAt: null }).session(session)) >= MAX_KIDS_PER_FAMILY) return { ok: false, error: "limitReached" } as const;
    const [kid] = await Kid.create([{ familyId: fid, firstName: input.firstName, birthYear: input.birthYear, displayName: input.displayName, itemCap: input.itemCap }], { session });
    await audit(parent.id, "kid.add", kid!._id, session);
    return { ok: true, id: String(kid!._id) } as const;
  });
}

export async function updateKid(parent: Parent, rawId: string, input: KidInput): Promise<KidResult> {
  const id = normalizeObjectId(rawId);
  const fid = await ownFamilyId(parent);
  if (!id || !fid) return { ok: false, error: "notFound" };
  return withTransaction(async (session) => {
    const res = await Kid.updateOne(
      { _id: id, familyId: fid, archivedAt: null },
      { $set: { firstName: input.firstName, birthYear: input.birthYear, displayName: input.displayName, itemCap: input.itemCap } },
      { session, runValidators: true },
    );
    if (res.matchedCount !== 1) return { ok: false, error: "notFound" } as const;
    await audit(parent.id, "kid.update", id, session);
    return { ok: true, id } as const;
  });
}

/** Really delete the kid's record (COPPA deletion right). */
// Deleting a child: eraseKid in ./erase.ts (releases gifts, keeps store-owed rows, forfeits magic).
