"use client";
/**
 * "Add as a surprise" (parent, PIN). `blocked` = the page's own pre-check (reason key) so the parent sees WHY before
 * pressing; the server re-checks anyway. Reuses the child's "why" messages; "locked" = the PIN timed out.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { Link } from "@/i18n/navigation";
import { addSurpriseAction, type AddSurpriseState } from "../actions";

export function AddSurpriseForm({ kidId, itemId, blocked, cap }: { kidId: string; itemId: string; blocked: string | null; cap: number }) {
  const t = useTranslations("Surprise");
  const g = useTranslations("Gifts");
  const [state, action, pending] = useActionState(addSurpriseAction, { status: "idle" } as AddSurpriseState);
  const hydrated = useHydrated();
  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-3">
        <Alert>{t("added")}</Alert>
        <Link href={`/kids/${kidId}/surprise`} className="self-start font-semibold underline underline-offset-4">
          {t("seeSurprises")}
        </Link>
      </div>
    );
  }
  const reason = state.status === "error" ? state.error : blocked;
  const message = !reason ? null : reason === "locked" ? t("locked") : reason === "cap" ? g("why.cap", { cap }) : g(`why.${reason}` as "why.alreadyListed");
  return (
    <form action={action} className="flex flex-col gap-3">
      {message && <Alert tone={state.status === "error" ? "error" : undefined}>{message}</Alert>}
      <input type="hidden" name="kidId" value={kidId} />
      <input type="hidden" name="itemId" value={itemId} />
      <Button type="submit" pending={pending} disabled={!hydrated || Boolean(blocked)} className="self-start">
        {t("add")}
      </Button>
    </form>
  );
}
