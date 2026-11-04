/**
 * Season = admin overrides for one Christmas year. Default dates come from
 * @repo/lib/season; a field left empty here means "use the default calendar".
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { objectId, seasonYearField } from "./_shared.ts";

const seasonSchema = new Schema(
  {
    year: { ...seasonYearField, unique: true },
    openAt: Date,
    freezeAt: Date,
    closeAt: Date,
    /** Admin "force Dec 1 freeze" switch. */
    forceFrozen: { type: Boolean, default: false },
    /** Admin override for the store item-list window. */
    storeWindow: {
      type: String,
      enum: ["auto", "open", "closed"],
      default: "auto",
    },
    updatedByUserId: objectId("User", false),
    notes: { type: String, maxlength: 1000 },
  },
  { timestamps: true, versionKey: false },
);

export type SeasonDoc = InferSchemaType<typeof seasonSchema>;
export const Season = (models.Season ??
  model("Season", seasonSchema)) as Model<SeasonDoc>;
