"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { markShippedAction, type ShipState } from "./actions";

/** One "ready to ship" gift: optional tracking text + "Mark shipped". */
export function ShipForm({ wishId, refCode }: { wishId: string; refCode: string }) {
  const t = useTranslations("Orders");
  const [state, action, pending] = useActionState(markShippedAction, { status: "idle" } as ShipState);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}`)}</Alert>}
      <input type="hidden" name="wishId" value={wishId} />
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span>{t("tracking")}</span>
        <input name="tracking" maxLength={100} placeholder={t("trackingPlaceholder")} className="rounded-lg border border-foreground/20 bg-background px-3 py-2" aria-label={t("trackingFor", { ref: refCode })} />
      </label>
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {t("markShipped")}
      </Button>
    </form>
  );
}
