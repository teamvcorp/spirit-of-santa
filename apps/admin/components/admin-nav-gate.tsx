/**
 * Server side of the admin section links: only a signed-in ADMIN (with two-step sign-in set up)
 * gets them. Reads the session, so the layout renders it inside <Suspense>.
 */
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@repo/auth";
import { authOptions } from "@/auth";
import { ADMIN_SECTIONS, type AdminSection } from "@/lib/sections";
import { AdminNav } from "./admin-nav";

export async function AdminNavGate() {
  await connection();
  const user = await getSessionUser(authOptions); // restricted (no MFA yet) sessions count as signed out
  if (user?.role !== "admin") return null;
  const common = await getTranslations("Common");
  const names = Object.fromEntries(ADMIN_SECTIONS.map((s) => [s, common(`nav.${s}`)])) as Record<AdminSection, string>;
  return <AdminNav label={common("nav.adminSections")} names={names} />;
}
