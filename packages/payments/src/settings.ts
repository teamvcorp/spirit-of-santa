/**
 * Platform settings (Phase 5 slice 2): donation-pool fee + the charity on tax receipts. SERVER-ONLY.
 * Reads: anyone's server code (the /donate page shows the fee). Writes: admins only (the caller
 * checks the role; we re-check the input with Zod here), one audited change per save.
 */
import "server-only";
import { z } from "zod";
import { AuditLog, connectDb, PlatformSettings, withTransaction } from "@repo/db";
import { MAX_DONATION_FEE_BPS } from "@repo/lib/limits";

export type PlatformSettingsView = {
  /** null = never chosen (the Dec 1 split refuses to run until it is). */
  donationFeeBps: number | null;
  charity: { legalName: string; ein: string; address: string };
  receiptsEnabled: boolean;
  /** Receipts can actually go out: switched on AND name + EIN filled in. */
  receiptsReady: boolean;
};

export async function getPlatformSettings(): Promise<PlatformSettingsView> {
  await connectDb();
  const s = await PlatformSettings.findOne({ key: "platform" }).lean();
  const charity = { legalName: s?.charity?.legalName ?? "", ein: s?.charity?.ein ?? "", address: s?.charity?.address ?? "" };
  const receiptsEnabled = s?.receiptsEnabled ?? false;
  return {
    donationFeeBps: typeof s?.donationFeeBps === "number" ? s.donationFeeBps : null,
    charity,
    receiptsEnabled,
    receiptsReady: receiptsEnabled && charity.legalName !== "" && charity.ein !== "",
  };
}

/** "12.5" (percent, up to 2 decimals) → 1250 basis points; null if not a valid fee. */
export function percentToBps(input: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps <= MAX_DONATION_FEE_BPS ? bps : null;
}

export const settingsInputSchema = z.object({
  donationFeeBps: z.number().int().min(0).max(MAX_DONATION_FEE_BPS),
  legalName: z.string().trim().max(120),
  ein: z.union([z.literal(""), z.string().regex(/^\d{2}-\d{7}$/)]),
  address: z.string().trim().max(200),
  receiptsEnabled: z.boolean(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;

export type SettingsResult = { ok: true } | { ok: false; error: "invalid" | "receiptsNeedCharity" };

/** Save all settings at once (admin). Turning receipts ON needs the charity's name + EIN. */
export async function updatePlatformSettings(adminUserId: string, raw: SettingsInput): Promise<SettingsResult> {
  const parsed = settingsInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (v.receiptsEnabled && (v.legalName === "" || v.ein === "")) return { ok: false, error: "receiptsNeedCharity" };
  await connectDb();
  await withTransaction(async (session) => {
    const before = await PlatformSettings.findOne({ key: "platform" }).session(session).lean();
    const after = await PlatformSettings.findOneAndUpdate(
      { key: "platform" },
      {
        $set: {
          donationFeeBps: v.donationFeeBps,
          "charity.legalName": v.legalName,
          "charity.address": v.address,
          receiptsEnabled: v.receiptsEnabled,
          updatedByUserId: adminUserId,
          ...(v.ein ? { "charity.ein": v.ein } : {}),
        },
        ...(v.ein ? {} : { $unset: { "charity.ein": 1 } }),
      },
      { upsert: true, session, runValidators: true, returnDocument: "after", projection: { _id: 1 } },
    );
    if (!after) throw new Error("settings upsert returned nothing");
    // Audit what changed (all of it is business data, no personal data).
    await AuditLog.create(
      [
        {
          actorUserId: adminUserId,
          action: "settings.update",
          targetType: "settings",
          targetId: String(after._id),
          details: {
            feeBps: { from: before?.donationFeeBps ?? null, to: v.donationFeeBps },
            receiptsEnabled: { from: before?.receiptsEnabled ?? false, to: v.receiptsEnabled },
            charityChanged:
              (before?.charity?.legalName ?? "") !== v.legalName || (before?.charity?.ein ?? "") !== v.ein || (before?.charity?.address ?? "") !== v.address,
          },
        },
      ],
      { session },
    );
  });
  return { ok: true };
}
