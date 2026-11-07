import { getTranslations } from "next-intl/server";
import { SectionNav } from "@repo/ui/section-nav";
import { Link } from "@/i18n/navigation";

/** Dashboard sub-navigation (shared SectionNav). Owners see Profile + Reps; reps see what they can use. */
export async function DashboardNav({ isOwner, current }: { isOwner: boolean; current: "overview" | "items" | "orders" | "profile" | "reps" }) {
  const t = await getTranslations("Dashboard.nav");
  const items = [
    { key: "overview", href: "/dashboard", show: true },
    { key: "items", href: "/dashboard/items", show: true },
    { key: "orders", href: "/dashboard/orders", show: true },
    { key: "profile", href: "/dashboard/profile", show: isOwner },
    { key: "reps", href: "/dashboard/reps", show: isOwner },
  ] as const;
  return (
    <SectionNav
      label={t("label")}
      LinkComponent={Link}
      className="mb-6"
      items={items.filter((i) => i.show).map((i) => ({ key: i.key, href: i.href, label: t(i.key), current: i.key === current }))}
    />
  );
}
