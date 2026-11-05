# Vercel Blob (`@vercel/blob` 2.8.2) + app icons: our notes

> Saved 2026-11-05 from vercel.com/docs/vercel-blob (pages last updated Aug–Sep 2026) and the
> bundled Next 16 docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/`).
> Code: `packages/storage` (upload/delete), `packages/ui/src/app-icon.tsx` (icons + manifest).

## Decisions (user, 2026-11-05)

- **Vercel Blob, PUBLIC store**, replaces Cloudinary. Product/store photos only. Public = anyone
  with the URL can view; writing needs our token/OIDC. **Never** store kids/family photos,
  IDs, receipts or documents there (use a separate *private* store if ever needed).
- **No installable app / PWA.** Just a home-screen icon that opens the site (`display: "browser"`).

## Auth (how the SDK finds credentials)

Resolution order: explicit `token` option → OIDC (`VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID`) →
`BLOB_READ_WRITE_TOKEN`.
- On Vercel: connect the store to the **store** project → Vercel adds `BLOB_STORE_ID` and
  rotates `VERCEL_OIDC_TOKEN` automatically (preferred: no long-lived secret).
- Locally: `apps/store/.env.local` has `BLOB_STORE_ID` + `BLOB_READ_WRITE_TOKEN` (no OIDC token
  locally, so the SDK uses the static token). Never pass tokens around in code.
- **Family + admin** only need `BLOB_STORE_ID` (not secret) so next.config can allow-list the
  image host. Don't connect the store to them (least privilege: they never write).

## API facts we rely on

- `put(pathname, body, { access: "public", contentType, addRandomSuffix, allowOverwrite, cacheControlMaxAge })`
  → `{ url, downloadUrl, pathname, contentType, contentDisposition, etag }`.
  - `addRandomSuffix` default false; `allowOverwrite` default false (throws on clash).
  - `cacheControlMaxAge` default 1 month, min 60s. We use 1 year (names are unique/immutable).
- `del(urlOrPathname | array)`: never throws for missing blobs; CDN may serve a deleted blob ~1 min.
- Public URL: `https://<storeid lowercased, no "store_">.public.blob.vercel-storage.com/<pathname>`
  (verified live 2026-11-05; `blobPublicHost()` computes it).
- **Server uploads are capped at 4.5 MB** (Vercel Function request body). We cap at 4 MB. Bigger
  files would need client uploads (`handleUpload` + `upload()` from `@vercel/blob/client`), which
  can't use OIDC and skip our re-encode step: avoid unless needed.
- Private stores (not used): `access: "private"`, read via `get()` in an authed route, SDK ≥ 2.3.

## Our upload pipeline (`uploadPublicImage`)

size ≤ 4 MB → magic-byte sniff (JPEG/PNG/WebP only, never SVG) → sharp re-encode
(`limitInputPixels` 50 MP, `failOn: "error"`, `autoOrient`, fit inside 1600px, WebP q82, metadata
stripped by default) → `put("<folder>/<ownerId>/<uuid>.webp")`. Errors the user can fix throw
`ImageUploadError` with a code (`empty | too_large | unsupported_type | unreadable`) to translate.
Callers must authorise first (role + owns the item/store). `deletePublicImage` re-checks folder +
owner from the pathname. DB stores `{ url, pathname }` (`imageSchema`).

sharp 0.35.5 is already installed by Next (prebuilt binaries; Vercel installs the linux build).
Node type-stripping can't run TS parameter properties (`constructor(readonly x)`): use plain fields.

## When building the upload Server Action (Phase 2), do these

- **Server Action body limit is 1 MB by default** (Next), below our 4 MB image cap. Raise it for
  the store app only: `experimental.serverActions.bodySizeLimit: "4.5mb"` in apps/store/next.config.ts
  (not family/admin: a bigger limit on every action is more DoS surface). Or use a route handler.
- Authorise first (`requireRole` + item/store belongs to the user), then `uploadPublicImage`, then
  save its **return value** as-is (never a url/pathname from the form). `imageSchema` rejects
  URLs that aren't `https://<id>.public.blob.vercel-storage.com/<pathname>` anyway.
- On replace/remove: save the DB change first, then `deletePublicImage(oldPathname, owner)`.
- Review notes (2026-11-05): pixel cap lowered to 24 MP. If memory is ever a problem, consider
  `sharp.concurrency(1)` / `sharp.cache(false)` in the upload route.

## next/image

`images: blobImagesConfig(process.env.BLOB_STORE_ID)` in each app's next.config: exact host +
`/items/**`, `/stores/**` only. A wildcard host would let anyone's blobs use our optimizer (our bill).
Verified: our photo 200; another store's host 400; other folder 400.

## Icons + manifest (Next 16 file conventions)

- `app/icon.tsx` with `generateImageMetadata` → `/icon/32`, `/icon/192`, `/icon/512` (PNG, built at
  build time; `<link>` hrefs get a `?hash` cache-buster).
- `app/apple-icon.tsx` → `/apple-icon` 180×180 (iOS rounds corners; keep it square, opaque).
- `app/manifest.ts` → `/manifest.webmanifest`, `display: "browser"` (shortcut, not an app).
- **Gotcha hit:** the generated icon URLs have no dot, so the locale proxy matched them and they
  404'd via `[...rest]`. Matcher now excludes `icon/` and `apple-icon`.
- `favicon.ico` can't be generated; we dropped the template one (the PNG `<link rel="icon">` covers it).
- iOS web push only works for Home Screen web apps: relevant when Phase 7 push is designed.
