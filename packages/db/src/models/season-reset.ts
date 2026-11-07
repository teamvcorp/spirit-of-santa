/**
 * SeasonReset = the season-end job for ONE ended season (Phase 5 slice 3), run on/after Jan 1.
 * Roadmap: "Jan 1: unclaimed pooled funds retained by Spirit of Santa; point balances reset to zero".
 *  - Community-donation gifts still HELD for that season (not shared by the freeze split) become
 *    "retained" (platform), counted here so nothing disappears silently.
 *  - Every kid's available points go to 0 with a `season_reset` ledger row (amount = the balance).
 * status running → done; a run cut off is resumed (idempotent per kid). Unique per seasonYear.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centipointsField, centsField, seasonYearField } from "./_shared.ts";

const seasonResetSchema = new Schema(
  {
    /** The season that ENDED (e.g. 2026, reset on Jan 1 2027). */
    seasonYear: { ...seasonYearField, unique: true },
    status: { type: String, enum: ["running", "done"], default: "running" },
    /** Kids still holding points after their reset row (race / bad data): flagged for an admin, never blocking. */
    needsAttention: { type: Number, min: 0 },
    /** Set (audited) when an admin has handled the flagged kids; until then the daily job fails every day. */
    attentionClearedAt: Date,
    attentionClearedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    kidsReset: { type: Number, default: 0, min: 0 },
    centipointsReset: { ...centipointsField(), default: 0 },
    retainedCents: { ...centsField(), default: 0 },
    retainedCount: { type: Number, default: 0, min: 0 },
    finishedAt: Date,
  },
  { timestamps: true, versionKey: false },
);

export type SeasonResetDoc = InferSchemaType<typeof seasonResetSchema>;
export const SeasonReset = (models.SeasonReset ?? model("SeasonReset", seasonResetSchema)) as Model<SeasonResetDoc>;
