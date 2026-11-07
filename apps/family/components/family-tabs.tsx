/**
 * Server side of the tab bar: only a signed-in PARENT's device gets it (the family's own device).
 * Visitors (deed QR pages, donate, legal pages, signed out) never see it. Reads the session, so the
 * layout renders it inside <Suspense> (request-time data under Cache Components).
 */
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@repo/auth";
import { authOptions } from "@/auth";
import { TabBar } from "./tab-bar";

export async function FamilyTabs() {
  await connection();
  const user = await getSessionUser(authOptions);
  if (user?.role !== "parent") return null;
  const t = await getTranslations("Tabs");
  return <TabBar labels={{ home: t("home"), wishlist: t("wishlist"), gifts: t("gifts"), parent: t("parent"), nav: t("label") }} />;
}
