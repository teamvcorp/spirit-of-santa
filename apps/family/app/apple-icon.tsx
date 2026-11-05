// iPhone/iPad home-screen icon (apple-touch-icon, 180px). Art: @repo/ui/app-icon.
import { APP_ICON_THEMES, renderAppIcon } from "@repo/ui/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(size.width, APP_ICON_THEMES.family);
}
