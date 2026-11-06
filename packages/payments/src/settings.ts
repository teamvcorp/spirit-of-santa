/**
 * Platform settings (Phase 5 slice 2): donation-pool fee + the charity on tax receipts. SERVER-ONLY.
 * Reads: anyone's server code (the /donate page shows the fee). Writes: admins only (the caller
 * checks the role; we re-check the input with Zod here), one audited change per save.
 */
import "server-only";
import { z } from "zod";
import { AuditLog, connectDb, PlatformSettings, withTransaction } from "@repo/db";
import { MAX_DONATION_FEE_BPS } from "@repo/lib/limits";
import { parseIsoDay, startOfDayInZone } from "@repo/lib/season";

export type PlatformSettingsView = {
  /** null = never chosen (the Dec 1 split refuses to run until it is). */
  donationFeeBps: number | null;
  charity: { legalName: string; ein: string; address: string };
  receiptsEnabled: boolean;
  /** Receipts cover gifts from this calendar day ("" = not set). */
  receiptsFromDay: string;
  /** Receipts can actually go out: switched on AND name + EIN + start day filled in. */
  receiptsReady: boolean;
  /** Start of receiptsFromDay (Central-Time midnight), or null. */
  receiptsFrom: Date | null;
  /** Where stores ship funded gifts ("" = not set: store emails wait until it is). Multi-line. */
  shippingAddress: string;
};

export async function getPlatformSettings(): Promise<PlatformSettingsView> {
  await connectDb();
  const s = await PlatformSettings.findOne({ key: "platform" }).lean();
  const charity = { legalName: s?.charity?.legalName ?? "", ein: s?.charity?.ein ?? "", address: s?.charity?.address ?? "" };
  const receiptsEnabled = s?.receiptsEnabled ?? false;
  const receiptsFromDay = s?.receiptsFromDay ?? "";
  return {
    donationFeeBps: typeof s?.donationFeeBps === "number" ? s.donationFeeBps : null,
    charity,
    receiptsEnabled,
    receiptsFromDay,
    receiptsReady: receiptsEnabled && charity.legalName !== "" && charity.ein !== "" && receiptsFromDay !== "",
    receiptsFrom: receiptsFromDay ? startOfDayInZone(receiptsFromDay) : null,
    shippingAddress: s?.shippingAddress ?? "",
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
  receiptsFromDay: z.union([z.literal(""), z.string().refine((d) => parseIsoDay(d) !== null)]),
  /** Line breaks normalised to \n (browsers send \r\n); max 6 lines. */
  shippingAddress: z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join("\n"))
    .pipe(z.string().max(300).refine((v) => v.split("\n").length <= 6)),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;

export type SettingsResult = { ok: true } | { ok: false; error: "invalid" | "fee" | "ein" | "fromDay" | "receiptsNeedCharity" | "shippingAddress" };

/** Save all settings at once (admin). Turning receipts ON needs the charity's name + EIN. */
export async function updatePlatformSettings(adminUserId: string, raw: SettingsInput): Promise<SettingsResult> {
  const parsed = settingsInputSchema.safeParse(raw);
  if (!parsed.success) {
    // Name the field the admin got wrong (the ONE place these rules live).
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, error: field === "donationFeeBps" ? "fee" : field === "ein" ? "ein" : field === "receiptsFromDay" ? "fromDay" : field === "shippingAddress" ? "shippingAddress" : "invalid" };
  }
  const v = parsed.data;
  if (v.receiptsEnabled && (v.legalName === "" || v.ein === "")) return { ok: false, error: "receiptsNeedCharity" };
  if (v.receiptsEnabled && v.receiptsFromDay === "") return { ok: false, error: "fromDay" };
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
          shippingAddress: v.shippingAddress,
          updatedByUserId: adminUserId,
          ...(v.ein ? { "charity.ein": v.ein } : {}),
          ...(v.receiptsFromDay ? { receiptsFromDay: v.receiptsFromDay } : {}),
        },
        ...(v.ein && v.receiptsFromDay ? {} : { $unset: { ...(v.ein ? {} : { "charity.ein": 1 }), ...(v.receiptsFromDay ? {} : { receiptsFromDay: 1 }) } }),
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
            receiptsFromDay: { from: before?.receiptsFromDay ?? null, to: v.receiptsFromDay || null },
            shippingAddressChanged: (before?.shippingAddress ?? "") !== v.shippingAddress,
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
