import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** Dashboard sub-navigation. Owners see Profile + Reps; reps see what they can use. */
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
    <nav aria-label={t("label")} className="mb-6 flex flex-wrap gap-2">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <Link
            key={i.key}
            href={i.href}
            aria-current={i.key === current ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${i.key === current ? "border-primary bg-primary text-on-primary" : "border-foreground/20"}`}
          >
            {t(i.key)}
          </Link>
        ))}
    </nav>
  );
}