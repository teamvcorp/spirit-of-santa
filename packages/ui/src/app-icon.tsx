/**
 * App icons + web manifest, shared by all three apps (each passes its own theme).
 *
 * User decision (2026-11-05): NO installable app / PWA. Just a home-screen icon that opens
 * the website. So:
 *  - Each app's `app/icon.tsx` and `app/apple-icon.tsx` render PNGs from this artwork at
 *    build time (Next file conventions, no image files to keep in sync).
 *  - `app/manifest.ts` uses `display: "browser"`: "Add to Home screen" makes a shortcut
 *    that opens a normal browser tab. No service worker, no offline mode, nothing to update.
 *  - iPhone uses the apple-touch-icon (180px, square, no transparency; iOS rounds corners).
 *
 * Artwork (owner's simple badge, 2026-11-08): gift + bow, no lettering. The designer's rule: simple badge for
 * anything under 96 px; lettering turns into noise at tab size. Source + how to update: scripts/brand/build-logo.mjs.
 */
import { ImageResponse } from "next/og";
import type { MetadataRoute } from "next";
import { LOGO_ICON_DATA_URL } from "./brand-art.generated.ts";

export type AppIconTheme = {
  /** Tile behind the round badge (home-screen icons). Lets the owner tell the three apps apart. */
  background: string;
};

// Rendered PNGs can't read CSS variables: these MUST match theme.css (--color-night, --color-night-deep,
// --color-snow). Admin is snow-white (was berry red) so the red badge doesn't vanish into its tile.
export const APP_ICON_THEMES = {
  family: { background: "#1b2a4a" },
  store: { background: "#0f1a33" },
  admin: { background: "#f8fafc" },
} satisfies Record<string, AppIconTheme>;

/** Sizes for `generateImageMetadata` in app/icon.tsx → served at /icon/<id>. */
export const APP_ICON_SIZES = [32, 192, 512].map((px) => ({
  id: String(px),
  size: { width: px, height: px },
  contentType: "image/png",
}));

/** Up to this size (browser tabs) the badge fills the square on a see-through background: every pixel counts. */
const TAB_ICON_MAX_PX = 48;

function BadgeArt({ px, theme }: { px: number; theme: AppIconTheme }) {
  const tab = px <= TAB_ICON_MAX_PX;
  // Home-screen tiles: opaque tile (iOS requires it) with a margin, so the round badge isn't cut by rounded corners.
  const badge = tab ? px : Math.round(px * 0.84);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: tab ? "transparent" : theme.background,
      }}
    >
      {/* Satori (next/og) draws SVG images itself; width/height are required. */}
      <img src={LOGO_ICON_DATA_URL} width={badge} height={badge} alt="" />
    </div>
  );
}

/** Render one square PNG icon (used by icon.tsx and apple-icon.tsx). */
export function renderAppIcon(px: number, theme: AppIconTheme): ImageResponse {
  return new ImageResponse(<BadgeArt px={px} theme={theme} />, { width: px, height: px });
}

/** Web manifest for "Add to Home screen". `display: "browser"` = shortcut, not an app. */
export function appManifest({
  name,
  shortName,
  theme,
}: {
  name: string;
  shortName: string;
  theme: AppIconTheme;
}): MetadataRoute.Manifest {
  return {
    name,
    short_name: shortName,
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: theme.background,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
