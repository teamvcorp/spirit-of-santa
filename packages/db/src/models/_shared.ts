/**
 * Reusable schema pieces so every model validates money/points the same way.
 * Units (cents, centipoints) are defined in packages/lib/src/constants.ts.
 */
import mongoose from "mongoose";
const { Schema } = mongoose;

const isSafeInt = {
  validator: (v: unknown) => v == null || Number.isSafeInteger(v),
  message: "{PATH} must be an integer",
};

/** Non-negative integer USD cents. */
export const centsField = (required = true) =>
  ({ type: Number, required, min: 0, validate: isSafeInt }) as const;

/** Non-negative integer centipoints (hundredths of a point). */
export const centipointsField = (required = true) =>
  ({ type: Number, required, min: 0, validate: isSafeInt }) as const;

/** Christmas year a record belongs to (see getSeasonYear in @repo/lib/season). */
export const seasonYearField = {
  type: Number,
  required: true,
  min: 2026,
  max: 2100,
  validate: isSafeInt,
} as const;

export const objectId = (ref: string, required = true) =>
  ({ type: Schema.Types.ObjectId, ref, required }) as const;

// Supported languages live in @repo/lib/locales (one list for DB, routing and UI).
export { LOCALES } from "@repo/lib/locales";

/** An uploaded Cloudinary image. Keep publicId so the image can be deleted later. */
export const imageSchema = new Schema(
  {
    url: { type: String, required: true, maxlength: 500, match: /^https:\/\// },
    publicId: { type: String, required: true, maxlength: 200 },
  },
  { _id: false },
);

/**
 * toJSON options: strip the version key and any secret fields, so even if a document is
 * accidentally returned from an API or passed to a Client Component, hashes never leak.
 * (Secret fields also use `select: false`, so they're not loaded unless asked for.)
 */
export function hideFields(...fields: string[]) {
  return {
    versionKey: false,
    transform(_doc: unknown, ret: Record<string, unknown>) {
      for (const f of fields) delete ret[f];
      return ret;
    },
  };
}
