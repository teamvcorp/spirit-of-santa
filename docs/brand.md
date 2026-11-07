# Logo and link previews

The Spirit of Santa logo (owner's artwork, added 2026-11-07) appears in four places. All four come from **one
designer file**:

| Where | Which version | Made by |
| --- | --- | --- |
| Header of all three apps (next to the "Spirit of Santa" name) | full badge, with "SPIRIT OF SANTA" round the ring | `packages/ui/src/logo.tsx` |
| Browser tab icon (32px) | simple badge: gift and bow only, see-through corners | `packages/ui/src/app-icon.tsx` |
| Phone home-screen icons (180, 192, 512px) | simple badge on a coloured tile: family navy, store dark navy, admin white | `packages/ui/src/app-icon.tsx` |
| Link-preview picture (Facebook, iMessage, WhatsApp, X…) for the family and store sites | full badge + translated title and tagline | `packages/ui/src/share-image.tsx` via each app's `app/[locale]/share-image/route.ts` |

The simple version exists because the ring lettering turns into noise below about 48px.

## Changing the logo

1. Save the new designer SVG over `packages/ui/assets/logo-source.svg` (keep the name).
2. Run `npm run brand:logo`. The script (`scripts/brand/build-logo.mjs`):
   - removes hidden duplicate text (the designer file has the lettering twice: as gold outlines AND as plain black
     text in a font most devices don't have),
   - makes the canvas square and centred,
   - builds the simple version (no lettering, no outer ring),
   - shrinks both with svgo,
   - writes `logo.svg`, `logo-icon.svg` and `packages/ui/src/brand-art.generated.ts`.
3. Open `packages/ui/assets/logo.svg` and `logo-icon.svg` in a browser and check them.
4. Commit all of those files.

The script matches **this** artwork's structure (13 letter shapes, one outer ring, one red disc). A differently made
file stops it with an error saying what it didn't find. Adjust the script's settings, don't hand-edit the outputs.

## Link previews: technical notes

- Every page of the family and store sites gets `og:*` and `twitter:*` tags (layout `generateMetadata`).
  The picture address is `/share-image` (English) or `/es/share-image` (Spanish).
- It's a plain route rather than Next's `opengraph-image` file. The file convention always puts `/en/` in English
  addresses, which our URLs drop, so every English preview would start with a redirect.
- Preview addresses must be absolute. The site address comes from `metadataOrigin()` (`@repo/lib/site`): the app's
  `FAMILY_APP_URL` / `STORE_APP_URL`, else Vercel's production domain, else the preview address, else localhost.
- The card is generic on purpose. It never shows a child, a family or a deed, even when the shared link is a child's
  QR page.
- To see what a platform shows after deploy, use Facebook's Sharing Debugger (developers.facebook.com/tools/debug)
  and paste the page address. It also clears Facebook's cached copy after a change.
