"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { unsubscribeAction, type UnsubscribeState } from "./actions";

export function UnsubscribeForm({ token, kindLabel }: { token: string; kindLabel: string }) {
  const t = useTranslations("Notify");
  const [state, action, pending] = useActionState(unsubscribeAction, { status: "idle" } as UnsubscribeState);
  const hydrated = useHydrated();
  if (state.status === "done") return <Alert>{t("unsubscribed", { kind: kindLabel })}</Alert>;
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.status === "error" && <Alert tone="error">{t("badLink")}</Alert>}
      <input type="hidden" name="t" value={token} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("stop", { kind: kindLabel })}
      </Button>
    </form>
  );
}
