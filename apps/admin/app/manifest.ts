// /manifest.webmanifest: home-screen shortcut only (display "browser"), not an installable app.
import { appManifest, APP_ICON_THEMES } from "@repo/ui/app-icon";

export default function manifest() {
  return appManifest({ name: "Spirit O Santa Admin", shortName: "SOS Admin", theme: APP_ICON_THEMES.admin });
}
