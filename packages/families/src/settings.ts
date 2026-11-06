/**
 * Family settings (parent area, PIN). SERVER-ONLY.
 * Public nickname: shown on QR pages as "From the {alias} family" only while switched on. It's the
 * ONLY family detail strangers can see (the real family name stays private). Audited.
 */
import "server-only";
import { AuditLog, Family, withTransaction } from "@repo/db";
import { ownFamilyId, type Parent } from "./kids.ts";

export async function getFamilySettings(parent: Parent): Promise<{ alias: string; show: boolean } | null> {
  const fid = await ownFamilyId(parent);
  if (!fid) return null;
  const f = await Family.findById(fid).select("alias showAliasPublicly").lean();
  return f ? { alias: f.alias ?? "", show: f.showAliasPublicly === true } : null;
}

/** Save the nickname; switching it on with an empty nickname is treated as off. */
export async function setFamilyAlias(parent: Parent, alias: string, show: boolean): Promise<{ ok: boolean }> {
  const fid = await ownFamilyId(parent);
  if (!fid) return { ok: false };
  const on = show && alias.length > 0;
  await withTransaction(async (session) => {
    await Family.updateOne({ _id: fid }, alias ? { $set: { alias, showAliasPublicly: on } } : { $unset: { alias: 1 }, $set: { showAliasPublicly: false } }, { session });
    // No alias text in the log: ids + on/off only.
    await AuditLog.create([{ actorUserId: parent.id, action: "family.alias", targetType: "family", targetId: fid, details: { shown: on } }], { session });
  });
  return { ok: true };
}
