/**
 * Server-only image storage on Vercel Blob (PUBLIC store).
 *
 * ⚠️ PUBLIC means anyone who has an image URL can view it (URLs are unguessable, but they
 * do get shared). So ONLY product/store photos go here. Never photos of kids or families,
 * IDs, receipts or documents. (Kids aren't even allowed photos: COPPA, see kid.ts.)
 * Writing still needs our secret, so only our server can add or delete files.
 *
 * Auth on Vercel: the SDK uses OIDC automatically (short-lived rotating token) when the
 * store is connected to the project. Locally it falls back to BLOB_READ_WRITE_TOKEN
 * from .env.local. We never pass tokens around in code.
 *
 * What uploadPublicImage() does to every file, and why:
 *  1. Size check (≤ 4 MB) before reading it all into memory.
 *  2. Real type check from the file's first bytes (JPEG/PNG/WebP only).
 *  3. Re-encode with sharp → WebP, max 1600px. This:
 *     - strips EXIF metadata, including the GPS location phones embed in photos
 *       (a photo taken at an owner's home would otherwise reveal their address),
 *     - destroys "polyglot" files (an image that is also valid HTML/JS),
 *     - applies the camera's rotation, and shrinks files for families on mobile data.
 *  4. Stores under a server-made name: <folder>/<ownerId>/<uuid>.webp. The uploader's
 *     filename is never used (no path tricks, no personal info in URLs).
 *
 * Deleting checks the pathname belongs to the expected folder AND owner, so one store
 * can't delete another store's photo by sending its pathname.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import sharp from "sharp";
import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE_PX, sniffImageType } from "./image-rules.ts";

/** Top-level folders. Add one here (and to PATHNAME_RE) for each new kind of image. */
export type ImageFolder = "items" | "stores";

export type StoredImage = {
  /** Public HTTPS URL to show in <Image>. */
  url: string;
  /** Blob pathname: what we keep to delete the file later. */
  pathname: string;
};

/** Reasons the user can fix. Show a translated message per code; never show raw errors. */
export type ImageUploadErrorCode = "empty" | "too_large" | "unsupported_type" | "unreadable";

export class ImageUploadError extends Error {
  // Plain field, not `constructor(readonly code)`: Node's type-stripping (used by our
  // tests) can't run TypeScript parameter properties.
  readonly code: ImageUploadErrorCode;
  constructor(code: ImageUploadErrorCode) {
    super(`Image upload rejected: ${code}`);
    this.code = code;
    this.name = "ImageUploadError";
  }
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/;
const PATHNAME_RE =
  /^(items|stores)\/([a-f0-9]{24})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** Decoding limit: stops "decompression bombs" (tiny file, gigantic pixel count). */
// 24 MP ≈ 6000x4000: covers phone cameras. Decoding can need several bytes per pixel (and a
// full copy for rotation), so a lower cap keeps one crafted upload from eating the memory
// shared by other requests on the same server instance (review hardening, 2026-11-05).
const MAX_INPUT_PIXELS = 24_000_000;

/** Files never change (new upload = new name), so browsers/CDN may cache them for a year. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Pure processing step (exported for tests): validate + re-encode. No network. */
export async function processImage(file: Blob): Promise<Buffer> {
  if (file.size === 0) throw new ImageUploadError("empty");
  if (file.size > MAX_IMAGE_BYTES) throw new ImageUploadError("too_large");

  const input = new Uint8Array(await file.arrayBuffer());
  if (!sniffImageType(input)) throw new ImageUploadError("unsupported_type");

  try {
    return await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error", // reject corrupt/truncated files instead of guessing
      autoOrient: true, // apply EXIF rotation before the metadata is dropped
    })
      .resize({
        width: MAX_IMAGE_EDGE_PX,
        height: MAX_IMAGE_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer(); // sharp drops all metadata (EXIF/GPS/XMP) unless told to keep it
  } catch {
    throw new ImageUploadError("unreadable");
  }
}

/**
 * Validate, clean and upload one image. Call ONLY after checking the signed-in user may
 * edit `ownerId` (e.g. requireRole + the item belongs to their store).
 */
export async function uploadPublicImage(
  file: Blob,
  { folder, ownerId }: { folder: ImageFolder; ownerId: string },
): Promise<StoredImage> {
  if (!OBJECT_ID_RE.test(ownerId)) throw new Error("uploadPublicImage: invalid ownerId");
  const body = await processImage(file);
  const result = await put(`${folder}/${ownerId}/${randomUUID()}.webp`, body, {
    access: "public",
    contentType: "image/webp",
    addRandomSuffix: false, // our UUID is already unique and unguessable
    allowOverwrite: false, // a name clash should fail loudly, never replace a file
    cacheControlMaxAge: ONE_YEAR_SECONDS,
  });
  return { url: result.url, pathname: result.pathname };
}

/** True if `pathname` is one of ours AND belongs to this folder + owner. */
export function isOwnedImagePath(
  pathname: string,
  { folder, ownerId }: { folder: ImageFolder; ownerId: string },
): boolean {
  const m = PATHNAME_RE.exec(pathname);
  return !!m && m[1] === folder && m[2] === ownerId;
}

/**
 * Delete an image we stored. Refuses anything that isn't this owner's file.
 * Deleting a missing file is not an error (safe to retry). Note: the CDN may keep
 * serving a deleted image for up to ~1 minute.
 */
export async function deletePublicImage(
  pathname: string,
  owner: { folder: ImageFolder; ownerId: string },
): Promise<void> {
  if (!isOwnedImagePath(pathname, owner)) {
    throw new Error("deletePublicImage: pathname does not belong to this owner");
  }
  await del(pathname);
}
