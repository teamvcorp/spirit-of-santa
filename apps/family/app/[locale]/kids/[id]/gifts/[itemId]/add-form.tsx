"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { Link } from "@/i18n/navigation";
import { addGiftAction, type AddGiftState } from "./actions";

/**
 * "Add to my wish list". `blocked` = the page's own pre-check (reason key) so the kid sees WHY
 * before pressing; the server re-checks anyway. `cap` fills the "list is full" message.
 */
export function AddGiftForm({ kidId, itemId, blocked, cap }: { kidId: string; itemId: string; blocked: string | null; cap: number }) {
  const t = useTranslations("Gifts");
  const [state, action, pending] = useActionState(addGiftAction, { status: "idle" } as AddGiftState);
  const hydrated = useHydrated(); // forms stay disabled until hydrated (see CODEMAP Phase 2 gotchas)
  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-3">
        <Alert>{t("added")}</Alert>
        <Link href={`/kids/${kidId}#wishlist`} className="self-start font-semibold underline underline-offset-4">
          {t("seeList")}
        </Link>
      </div>
    );
  }
  const reason = state.status === "error" ? state.error : blocked;
  // Typed keys: only "cap" takes a value; the others are plain strings.
  const message = !reason ? null : reason === "cap" ? t("why.cap", { cap }) : t(`why.${reason}` as "why.onList");
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
