"use client";
/**
 * The news confirm button. The link in the email only OPENS this page; nothing happens until the person presses
 * the button (mail security scanners pre-open links and would otherwise subscribe people by themselves).
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { newsConfirmAction, type NewsConfirmState } from "../actions";

export function NewsConfirmForm({ token }: { token: string }) {
  const t = useTranslations("News.confirm");
  const [state, action, pending] = useActionState(newsConfirmAction, { status: "idle" } as NewsConfirmState);
  const hydrated = useHydrated();

  if (state.status === "done") return <Alert>{t("done")}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === "invalidLink" && <Alert tone="error">{t("invalidLink")}</Alert>}
      <p>{t("intro")}</p>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {t("submit")}
      </Button>
    </form>
  );
}
