// /manifest.webmanifest: home-screen shortcut only (display "browser"), not an installable app.
import { appManifest, APP_ICON_THEMES } from "@repo/ui/app-icon";

export default function manifest() {
  return appManifest({ name: "Spirit of Santa", shortName: "Spirit of Santa", theme: APP_ICON_THEMES.family });
}
