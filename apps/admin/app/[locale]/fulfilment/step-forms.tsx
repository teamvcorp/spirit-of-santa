"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { receivedAction, sentAction, substituteAction, type StepState } from "./actions";

const IDLE: StepState = { status: "idle" };

function Errors({ state }: { state: StepState }) {
  const t = useTranslations("Fulfilment");
  return state.status === "error" && state.error ? <Alert tone="error">{t(`errors.${state.error}`)}</Alert> : null;
}

/** "Substitute arranged" + what was agreed with the store. */
export function SubstituteForm({ wishId, refCode }: { wishId: string; refCode: string }) {
  const t = useTranslations("Fulfilment");
  const [state, action, pending] = useActionState(substituteAction, IDLE);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-2">
      <Errors state={state} />
      <input type="hidden" name="wishId" value={wishId} />
      <label className="flex flex-col gap-1 text-sm">
        <span>{t("note")}</span>
        <textarea name="note" rows={2} maxLength={300} required minLength={3} aria-label={t("noteFor", { ref: refCode })} className="rounded-lg border border-foreground/20 bg-background px-3 py-2" />
      </label>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("substituteDone")}
      </Button>
    </form>
  );
}

/**
 * One-button step ("Received" / "Sent to family" / "Keep for Spirit of Santa"). "kept" is the SAME server step
 * as "sent" (closes the row as delivered); only the label differs, for gifts of a deleted family.
 */
export function StepButton({ wishId, kind }: { wishId: string; kind: "received" | "sent" | "kept" }) {
  const t = useTranslations("Fulfilment");
  const [state, action, pending] = useActionState(kind === "received" ? receivedAction : sentAction, IDLE);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-2">
      <Errors state={state} />
      <input type="hidden" name="wishId" value={wishId} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t(kind === "received" ? "markReceived" : kind === "kept" ? "markKept" : "markSent")}
      </Button>
    </form>
  );
}
