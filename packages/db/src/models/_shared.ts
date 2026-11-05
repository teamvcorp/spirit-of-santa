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

/**
 * An image in our public Vercel Blob store (made by @repo/storage/images uploadPublicImage).
 * Keep `pathname` so the file can be deleted when the item/store photo is replaced or removed.
 */
export const imageSchema = new Schema(
  {
    url: {
      type: String,
      required: true,
      maxlength: 500,
      // Defence in depth: only URLs from a Vercel Blob *public* store, ending in exactly our
      // pathname. Stops a future bug from saving an arbitrary (tracking/phishing) URL as a photo.
      validate: {
        validator(this: { pathname?: string }, v: string) {
          return isBlobImageUrl(v, this.pathname);
        },
        message: "url must be our Blob store URL for this pathname",
      },
    },
    pathname: { type: String, required: true, maxlength: 200, match: /^(items|stores)\/[a-f0-9]{24}\/[\w-]+\.webp$/ },
  },
  { _id: false },
);

/** True if `url` is https://<id>.public.blob.vercel-storage.com/<pathname> (exported for tests). */
export function isBlobImageUrl(url: string, pathname: string | undefined): boolean {
  if (!pathname) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(u.hostname) &&
      !u.port && !u.username && !u.password && !u.search && !u.hash &&
      u.pathname === `/${pathname}`
    );
  } catch {
    return false;
  }
}

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
