import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { blobPublicHost, MAX_IMAGE_BYTES, sniffImageType } from "../src/image-rules.ts";
import { ImageUploadError, isOwnedImagePath, processImage } from "../src/images.ts";

const OWNER = "0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba98";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

async function makePhoto(format: "jpeg" | "png" | "webp", withGps = false) {
  let img = sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#b3261e" } });
  if (withGps) img = img.withExif({ IFD0: { Make: "TestPhone", ImageDescription: "secret home" } });
  return img.toFormat(format).toBuffer();
}

test("sniffImageType trusts bytes, not names", async () => {
  assert.equal(sniffImageType(await makePhoto("jpeg")), "image/jpeg");
  assert.equal(sniffImageType(await makePhoto("png")), "image/png");
  assert.equal(sniffImageType(await makePhoto("webp")), "image/webp");
  const enc = new TextEncoder();
  for (const evil of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    "<!doctype html><script>alert(1)</script>",
    "GIF89a....",
    "MZ\x90\x00 (a Windows .exe)",
    "",
  ]) {
    assert.equal(sniffImageType(enc.encode(evil)), null, evil.slice(0, 20));
  }
});

test("processImage re-encodes to WebP, shrinks, and strips metadata", async () => {
  const input = await makePhoto("jpeg", true);
  assert.ok((await sharp(input).metadata()).exif, "fixture really has EXIF");

  const out = await processImage(new Blob([new Uint8Array(input)]));
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(Math.max(meta.width ?? 0, meta.height ?? 0), 1600);
  assert.equal(meta.exif, undefined, "EXIF (incl. GPS) must be gone");
  assert.ok(!out.includes(Buffer.from("secret home")));
});

test("processImage rejects bad input with a code the UI can translate", async () => {
  const code = async (b: Blob) =>
    processImage(b).then(
      () => "ok",
      (e: unknown) => (e instanceof ImageUploadError ? e.code : String(e)),
    );
  assert.equal(await code(new Blob([])), "empty");
  assert.equal(await code(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)])), "too_large");
  assert.equal(await code(new Blob(["<svg><script>alert(1)</script></svg>"])), "unsupported_type");
  // Right magic bytes, garbage after: a corrupt or disguised file.
  assert.equal(await code(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])])), "unreadable");
});

test("isOwnedImagePath only matches this folder + owner's files", () => {
  const mine = { folder: "items", ownerId: OWNER } as const;
  assert.ok(isOwnedImagePath(`items/${OWNER}/${UUID}.webp`, mine));
  for (const p of [
    `items/${OTHER}/${UUID}.webp`, // another store
    `stores/${OWNER}/${UUID}.webp`, // other folder
    `items/${OWNER}/../${OTHER}/${UUID}.webp`,
    `items/${OWNER}/${UUID}.webp/../../x`,
    `/items/${OWNER}/${UUID}.webp`,
    `https://evil.example/items/${OWNER}/${UUID}.webp`,
    `items/${OWNER}/${UUID}.svg`,
    "",
  ]) {
    assert.equal(isOwnedImagePath(p, mine), false, p);
  }
});

test("blobPublicHost builds exactly our store's host", () => {
  assert.equal(blobPublicHost("store_AbC123xyz"), "abc123xyz.public.blob.vercel-storage.com");
  assert.equal(blobPublicHost("abc123"), "abc123.public.blob.vercel-storage.com");
  assert.equal(blobPublicHost(undefined), null);
  assert.equal(blobPublicHost(""), null);
  assert.equal(blobPublicHost("store_evil.com/x"), null);
});
