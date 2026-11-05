/**
 * Client-safe image upload rules (no secrets, no Node APIs). Shared by:
 *  - upload forms (`accept` attribute, friendly "too big" check before sending),
 *  - the server upload helper in ./images.ts (the check that actually counts),
 *  - each app's next.config (which image host <Image> may load from).
 *
 * Why these limits:
 *  - 4 MB: Vercel Functions reject request bodies over 4.5 MB, and we upload through
 *    our own server (a Server Action) so we can check who's uploading and what the file is.
 *  - JPEG/PNG/WebP only: never SVG (it can contain scripts) and nothing exotic.
 *    The file's real type comes from its first bytes ("magic numbers"), NOT from the
 *    filename or the browser's Content-Type, both of which the uploader controls.
 */

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Longest side after resizing. Big enough for a product photo on a large phone. */
export const MAX_IMAGE_EDGE_PX = 1600;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** Value for <input type="file" accept=...>. A hint for the picker only, not security. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(",");

/**
 * Identify an image by its signature bytes. Returns null for anything we don't accept
 * (including SVG, GIF, HEIC, HTML or a renamed .exe).
 */
export function sniffImageType(bytes: Uint8Array): AcceptedImageType | null {
  const b = bytes;
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length >= 8 && png.every((v, i) => b[i] === v)) return "image/png";
  // WebP: "RIFF" ???? "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Public hostname of a Vercel Blob store, e.g. BLOB_STORE_ID "store_AbC123" →
 * "abc123.public.blob.vercel-storage.com". Used to allow-list exactly OUR store in
 * next.config `images.remotePatterns` (a wildcard would let anyone's blobs be run
 * through our image optimizer on our bill) and to refuse deleting foreign URLs.
 */
export function blobPublicHost(storeId: string | undefined): string | null {
  const id = storeId?.trim().replace(/^store_/i, "").toLowerCase();
  if (!id || !/^[a-z0-9]+$/.test(id)) return null;
  return `${id}.public.blob.vercel-storage.com`;
}

/** Folders <Image> may load from; keep in sync with ImageFolder in ./images.ts. */
const IMAGE_FOLDERS = ["items", "stores"] as const;

/**
 * `images` block for next.config: lets next/image optimise photos from OUR Blob store's
 * image folders only. Needs BLOB_STORE_ID (not a secret) in each app's env; without it
 * no remote images are allowed (safe default: images fail to load, nothing opens up).
 */
export function blobImagesConfig(storeId: string | undefined) {
  const hostname = blobPublicHost(storeId);
  return {
    remotePatterns: hostname
      ? IMAGE_FOLDERS.map((folder) => ({ protocol: "https" as const, hostname, pathname: `/${folder}/**` }))
      : [],
  };
}
