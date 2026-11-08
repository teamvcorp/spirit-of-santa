# Logo and link previews

The Spirit of Santa artwork (owner's designer files, updated 2026-11-08) comes in three versions:

| Version | Designer's rule | Used for | Made by |
| --- | --- | --- | --- |
| **Simple badge** (gift and bow, no lettering) | anything under 96 px | header of all three apps (48–56 px), browser tab (32 px), phone home-screen icons (180/192/512 px: badge on a coloured tile: family navy, store dark navy, admin white) | `packages/ui/src/logo.tsx`, `packages/ui/src/app-icon.tsx` |
| **Full-colour seal** ("SPIRIT OF SANTA · NORTH POLE APPROVED · EST. 2012") | 96 px / 1 inch and larger | link-preview picture (Facebook, iMessage, WhatsApp, X…) for the family and store sites, with the translated title and tagline | `packages/ui/src/share-image.tsx` via each app's `app/[locale]/share-image/route.ts` |
| **One-ink seal** | rubber stamps, foil, embossing | print only, never on the websites | `packages/ui/assets/print/seal-one-ink.svg` |

## Files

- `packages/ui/assets/source/`: the designer's files, unchanged: `badge-simple.svg`, `seal-full-color.svg`,
  `seal-one-ink.svg`.
- `packages/ui/assets/logo-icon.svg`: simple badge, shrunk (the apps use this).
- `packages/ui/assets/logo.svg`: full-colour seal, lettering converted to shapes, shrunk (the share picture uses it).
- `packages/ui/assets/print/`: both seals with the lettering as shapes. **Send these to a printer**, never the source
  files: the source files need the Nunito Sans font installed. For a different ink colour in the one-ink seal,
  replace `#C8102E` with the ink colour.

## Changing the logo

1. Save the new designer file over the matching file in `packages/ui/assets/source/` (keep the name).
2. Run `npm run brand:logo`. The script (`scripts/brand/build-logo.mjs`):
   - converts the seals' lettering to shapes, letter by letter along the same curves a browser uses. Phones without
     the font, and the server that draws the preview picture, would otherwise show the wrong font or no words at all.
   - shrinks the files with svgo,
   - writes `logo.svg`, `logo-icon.svg`, `print/*.svg` and `packages/ui/src/brand-art.generated.ts`.
3. Check the outputs in a browser next to the source files. The lettering should look the same.
4. Commit all of those files.

The lettering font is Nunito Sans 800 (`scripts/brand/fonts/`, from Fontsource 5.2.7, SIL Open Font License: free to
use and to keep in the repo). The script only understands this artwork's kind of lettering: words centred on a half
circle, or a straight centred line, in Nunito Sans 800. Anything else stops it with an error saying what it didn't
expect. Adjust the script, don't hand-edit the outputs.

## Link previews: technical notes

- Every page of the family and store sites gets `og:*` and `twitter:*` tags (layout `generateMetadata`).
  The picture address is `/share-image` (English) or `/es/share-image` (Spanish).
- It's a plain route rather than Next's `opengraph-image` file. The file convention always puts `/en/` in English
  addresses, which our URLs drop, so every English preview would start with a redirect.
- Preview addresses must be absolute. The site address comes from `metadataOrigin()` (`@repo/lib/site`): the app's
  `FAMILY_APP_URL` / `STORE_APP_URL`, else Vercel's production domain, else the preview branch address, else localhost.
- The card is generic on purpose. It never shows a child, a family or a deed, even when the shared link is a child's
  QR page.
- To see what a platform shows after deploy, use Facebook's Sharing Debugger (developers.facebook.com/tools/debug)
  and paste the page address. It also clears Facebook's cached copy after a change.
