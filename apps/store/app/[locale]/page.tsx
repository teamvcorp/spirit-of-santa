import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@repo/i18n/locale-switcher";

// Placeholder home page (step 2 of the Phase 1 plan replaces it with real UI).
export default function Home() {
  const t = useTranslations("HomePage");
  const common = useTranslations("Common");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="max-w-xl text-lg">{t("intro")}</p>
      <LocaleSwitcher label={common("languageSwitcher")} />
    </main>
  );
}
