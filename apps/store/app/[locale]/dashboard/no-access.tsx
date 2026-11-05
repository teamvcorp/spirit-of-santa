import { getTranslations } from "next-intl/server";
import { Alert } from "@repo/ui/alert";

/** Signed in, but not (or no longer) a member of a store. */
export async function NoAccess() {
  const t = await getTranslations("Dashboard");
  return <Alert tone="error">{t("noAccess")}</Alert>;
}