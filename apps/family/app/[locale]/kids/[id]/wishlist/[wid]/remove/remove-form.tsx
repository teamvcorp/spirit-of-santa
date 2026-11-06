"use client";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { Link } from "@/i18n/navigation";
import { removeGiftAction, type RemoveGiftState } from "./actions";

export function RemoveGiftForm({ kidId, wishId }: { kidId: string; wishId: string }) {
  const t = useTranslations("Gifts");
  const locale = useLocale();
  const [state, action, pending] = useActionState(removeGiftAction, { status: "idle" } as RemoveGiftState);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.status === "error" && state.error && <Alert tone="error">{t(`removeErrors.${state.error}`)}</Alert>}
      <input type="hidden" name="kidId" value={kidId} />
      <input type="hidden" name="wishId" value={wishId} />
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" pending={pending} disabled={!hydrated}>
          {t("removeConfirm")}
        </Button>
        <Link href={`/kids/${kidId}#wishlist`} className="underline underline-offset-4">
          {t("keep")}
        </Link>
      </div>
    </form>
  );
}
