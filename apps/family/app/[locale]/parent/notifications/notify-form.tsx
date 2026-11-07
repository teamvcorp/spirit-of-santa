"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { saveNotifyAction, type NotifyFormState } from "./actions";

const KINDS = ["magic", "deeds", "reminders"] as const;

export function NotifyForm({ prefs }: { prefs: Record<(typeof KINDS)[number], boolean> }) {
  const t = useTranslations("Notify");
  const [state, action, pending] = useActionState(saveNotifyAction, { status: "idle" } as NotifyFormState);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {state.status === "saved" && <Alert>{t("saved")}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}`)}</Alert>}
      {KINDS.map((k) => (
        <label key={k} className="flex items-start gap-3">
          <input type="checkbox" name={k} value="on" defaultChecked={prefs[k]} className="mt-1 size-5" />
          <span>
            <span className="font-semibold">{t(`kinds.${k}.label`)}</span>
            <span className="block text-sm text-foreground/70">{t(`kinds.${k}.help`)}</span>
          </span>
        </label>
      ))}
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("save")}
      </Button>
    </form>
  );
}
