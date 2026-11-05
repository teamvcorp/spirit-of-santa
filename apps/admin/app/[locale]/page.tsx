import { useTranslations } from "next-intl";

// Placeholder home page (real screens come in later phases).
export default function Home() {
  const t = useTranslations("HomePage");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">{t("title")}</h1>
      <p className="max-w-xl text-lg">{t("intro")}</p>
    </main>
  );
}
