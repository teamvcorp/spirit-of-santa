/**
 * Season = admin overrides for one Christmas year. Default dates come from
 * @repo/lib/season; a field left empty here means "use the default calendar".
 * The rules that combine both live in resolveSeason() (@repo/lib/season); servers read this
 * document through getSeasonState() (packages/stores/src/season.ts). Admin page: /season.
 */
const ISO_DAY = { type: String, match: /^\d{4}-\d{2}-\d{2}$/, maxlength: 10 } as const;
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { objectId, seasonYearField } from "./_shared.ts";

const seasonSchema = new Schema(
  {
    year: { ...seasonYearField, unique: true },
    /**
     * Custom dates as calendar days in the season time zone ("2027-10-15"), not timestamps:
     * same model as the defaults, no daylight-saving maths. Editable only before the season opens.
     */
    openDate: ISO_DAY,
    freezeDate: ISO_DAY,
    closeDate: ISO_DAY,
    /** Admin "force Dec 1 freeze" switch. */
    forceFrozen: { type: Boolean, default: false },
    /** Admin override for the store item-list window. */
    storeWindow: {
      type: String,
      enum: ["auto", "open", "closed"],
      default: "auto",
    },
    /** When last season's active items were copied into this season (@repo/stores/catalog-rollover). Set once. */
    catalogCopiedAt: { type: Date },
    updatedByUserId: objectId("User", false),
    notes: { type: String, maxlength: 1000 },
  },
  { timestamps: true, versionKey: false },
);

export type SeasonDoc = InferSchemaType<typeof seasonSchema>;
export const Season = (models.Season ??
  model("Season", seasonSchema)) as Model<SeasonDoc>;
