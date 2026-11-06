/**
 * PlatformSettings = ONE document (key "platform") of admin-set business settings (Phase 5 slice 2).
 * Read/write only through @repo/payments/settings (admin-only writes, audited "settings.update").
 *
 *  - donationFeeBps: Spirit O Santa's share of community-donation pools, taken off the top at the
 *    Dec 1 split (user decision 2026-11-06). Basis points: 1000 = 10%. NO default on purpose:
 *    the split refuses to run until an admin has chosen it.
 *  - charity: the 501(c)(3) named on tax receipts (Edynsgate). receiptsEnabled stays OFF until the
 *    admin confirms donations are received on the charity's behalf (a receipt is only valid then).
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { objectId } from "./_shared.ts";

const isSafeInt = { validator: (v: unknown) => v == null || Number.isSafeInteger(v), message: "{PATH} must be an integer" };

const platformSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, enum: ["platform"] },
    donationFeeBps: { type: Number, min: 0, max: 3000, validate: isSafeInt },
    charity: {
      legalName: { type: String, trim: true, maxlength: 120 },
      /** US Employer Identification Number, "12-3456789". */
      ein: { type: String, match: /^\d{2}-\d{7}$/ },
      address: { type: String, trim: true, maxlength: 200 },
    },
    receiptsEnabled: { type: Boolean, default: false },
    updatedByUserId: objectId("User", false),
  },
  { timestamps: true, versionKey: false },
);

export type PlatformSettingsDoc = InferSchemaType<typeof platformSettingsSchema>;
export const PlatformSettings = (models.PlatformSettings ?? model("PlatformSettings", platformSettingsSchema)) as Model<PlatformSettingsDoc>;
