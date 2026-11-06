"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { resetLinkAction, type LinkState } from "./donation-actions";

export function ResetLinkForm({ kidId }: { kidId: string }) {
  const t = useTranslations("Kid");
  const [state, action, pending] = useActionState(resetLinkAction, { status: "idle" } as LinkState);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.status === "done" && <Alert>{t("linkReset")}</Alert>}
      {state.status === "error" && <Alert tone="error">{t(state.error === "locked" ? "linkLocked" : "errors.notFound")}</Alert>}
      <input type="hidden" name="kidId" value={kidId} />
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start">
        {t("newLink")}
      </Button>
      <p className="text-xs text-foreground/70">{t("newLinkHelp")}</p>
    </form>
  );
}
