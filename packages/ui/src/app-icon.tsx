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
 * The star is a PLACEHOLDER until there's a real logo: swap <StarArt> and every icon updates.
 */
import { ImageResponse } from "next/og";
import type { MetadataRoute } from "next";

export type AppIconTheme = {
  /** Tile background. Family red, store green, admin charcoal: easy to tell apart. */
  background: string;
  /** Star colour. */
  foreground: string;
};

const GOLD = "#c9a227"; // --color-brand-gold in theme.css
export const APP_ICON_THEMES = {
  family: { background: "#b3261e", foreground: GOLD },
  store: { background: "#1f6f43", foreground: GOLD },
  admin: { background: "#2b2b2b", foreground: GOLD },
} satisfies Record<string, AppIconTheme>;

/** Sizes for `generateImageMetadata` in app/icon.tsx → served at /icon/<id>. */
export const APP_ICON_SIZES = [32, 192, 512].map((px) => ({
  id: String(px),
  size: { width: px, height: px },
  contentType: "image/png",
}));

function StarArt({ px, theme }: { px: number; theme: AppIconTheme }) {
  const star = Math.round(px * 0.66);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: theme.background,
      }}
    >
      <svg width={star} height={star} viewBox="0 0 100 100">
        <polygon
          fill={theme.foreground}
          points="50,4 61.8,36.8 96,36.8 68.4,57.6 78.8,92 50,71.2 21.2,92 31.6,57.6 4,36.8 38.2,36.8"
        />
      </svg>
    </div>
  );
}

/** Render one square PNG icon (used by icon.tsx and apple-icon.tsx). */
export function renderAppIcon(px: number, theme: AppIconTheme): ImageResponse {
  return new ImageResponse(<StarArt px={px} theme={theme} />, { width: px, height: px });
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
