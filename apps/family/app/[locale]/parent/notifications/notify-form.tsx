"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { NOTIFY_KINDS as KINDS, type NotifyPrefs } from "@repo/lib/notify";
import { saveNotifyAction, type NotifyFormState } from "./actions";

export function NotifyForm({ prefs, news }: { prefs: NotifyPrefs; news: boolean }) {
  const t = useTranslations("Notify");
  const [state, action, pending] = useActionState(saveNotifyAction, { status: "idle" } as NotifyFormState);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {state.status === "saved" && <Alert>{t("saved")}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}`)}</Alert>}
      {KINDS.map((k) => (
        <label key={k} className="flex items-start gap-3">
          {/* After an error: the parent's own (unsaved) choice, not the stored one. */}
          <input type="checkbox" name={k} value="on" defaultChecked={(state.values ?? prefs)[k]} className="mt-1 size-5" />
          <span>
            <span className="font-semibold">{t(`kinds.${k}.label`)}</span>
            <span className="block text-sm text-muted">{t(`kinds.${k}.help`)}</span>
          </span>
        </label>
      ))}
      {/* News (2026-11-12): a separate OPT-IN list (Resend), off unless chosen. Adults only: this is the parent. */}
      <label className="flex items-start gap-3 border-t border-foreground/10 pt-4">
        <input type="checkbox" name="news" value="on" defaultChecked={state.news ?? news} className="mt-1 size-5" data-testid="news-switch" />
        <span>
          <span className="font-semibold">{t("news.label")}</span>
          <span className="block text-sm text-muted">{t("news.help")}</span>
        </span>
      </label>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("save")}
      </Button>
    </form>
  );
}
