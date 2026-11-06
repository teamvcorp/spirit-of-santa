/**
 * DonationSplit = ONE run of the community-donation split (Phase 5 slice 2b). The permanent record
 * of how each pool was shared: what came in, the platform fee kept, how many kids, points each.
 * Written with the Payment updates in one transaction; kids are then credited in batches (status
 * "crediting" → "done"), resumable, each ledger row keyed by (run, pool, kid) so nothing doubles.
 *
 * Rules (user decisions 2026-11-06): at the season freeze (Dec 1) each pool ("all kids" or one
 * ZIP) has the admin-set fee taken off the top and the rest shared EQUALLY among registered kids.
 * A ZIP with no registered kids rolls into "all kids". Point leftovers from rounding = platform.
 * Gifts recorded after a run stay "held" and are shared by the next run (the cron runs daily).
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { centipointsField, centsField, objectId, seasonYearField } from "./_shared.ts";

export const SPLIT_POOL_STATUSES = ["split", "rolled", "tooSmall"] as const;

const poolSchema = new Schema(
  {
    /** null = the "all kids" pool. */
    zip: { type: String, match: /^\d{5}$/, default: null },
    /** split = shared; rolled = no kids in this ZIP, moved to "all kids"; tooSmall = < 1 centipoint each, kept held. */
    status: { type: String, enum: SPLIT_POOL_STATUSES, required: true },
    paymentCount: { type: Number, required: true, min: 0 },
    totalCents: centsField(),
    feeCents: centsField(),
    kids: { type: Number, required: true, min: 0 },
    perKidCentipoints: centipointsField(),
    /** Rounding leftover (points), kept by the platform. */
    leftoverCentipoints: centipointsField(),
    /** Exactly who this run credits (k = kid, f = family), fixed at planning time so a resumed run credits the same kids. */
    recipients: { type: [{ _id: false, k: { type: Schema.Types.ObjectId, required: true }, f: { type: Schema.Types.ObjectId, required: true } }], default: undefined },
  },
  { _id: false },
);

const donationSplitSchema = new Schema(
  {
    seasonYear: seasonYearField,
    trigger: { type: String, enum: ["cron", "admin"], required: true },
    adminUserId: objectId("User", false),
    feeBps: { type: Number, required: true, min: 0, max: 3000 },
    /** crediting = gifts settled, kids being credited in batches (resumed if interrupted); done = finished. */
    status: { type: String, enum: ["crediting", "done"], default: "done" },
    pools: { type: [poolSchema], default: [] },
    totalCents: centsField(),
    feeCents: centsField(),
    creditedCentipoints: centipointsField(),
    kidsCredited: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

donationSplitSchema.index({ seasonYear: 1, createdAt: -1 });
donationSplitSchema.index({ status: 1 }, { partialFilterExpression: { status: "crediting" } }); // unfinished runs

export type DonationSplitDoc = InferSchemaType<typeof donationSplitSchema>;
export const DonationSplit = (models.DonationSplit ?? model("DonationSplit", donationSplitSchema)) as Model<DonationSplitDoc>;
