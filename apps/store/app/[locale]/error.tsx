"use client";
/**
 * Translated error screen for anything that throws while rendering or in a Server Action
 * (e.g. a request rejected by the body-size limit). Next renders this instead of crashing
 * the whole page; "Try again" re-renders the segment. Details stay in server logs (the
 * `digest` links them) and are never shown to users.
 */
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("ErrorPage");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center" role="alert">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="max-w-md">{t("body")}</p>
      <Button onClick={() => reset()}>{t("retry")}</Button>
    </main>
  );
}