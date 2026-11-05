// Browser-tab + Android home-screen icons (PNG, built at build time). Art: @repo/ui/app-icon.
import { APP_ICON_SIZES, APP_ICON_THEMES, renderAppIcon } from "@repo/ui/app-icon";

export function generateImageMetadata() {
  return APP_ICON_SIZES;
}

export default async function Icon({ id }: { id: Promise<string> }) {
  return renderAppIcon(Number(await id), APP_ICON_THEMES.admin);
}
