import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("Common.notFound");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-bold">{t("title")}</h1>
      <p>{t("body")}</p>
      <Link href="/" className="underline">
        {t("home")}
      </Link>
    </main>
  );
}
