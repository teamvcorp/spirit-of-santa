"use client";
/** "Split now" (needs an explicit tick) and "Retry failed receipts". Rules live on the server. */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { formatCents } from "@repo/lib/format";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { retryReceiptsAction, runSplitAction, type DonationsFormState } from "./actions";

const INITIAL: DonationsFormState = { status: "idle" };

export function SplitForm({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Donations");
  const [state, action, pending] = useActionState(runSplitAction, INITIAL);
  const hydrated = useHydrated();
  const i = state.info;
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      {state.status === "done" && i && (
        <Alert>{i.kids ? t("splitDone", { kids: i.kids, amount: formatCents(i.cents ?? 0), fee: formatCents(i.fee ?? 0) }) : t("splitNothing")}</Alert>
      )}
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirm" value="yes" disabled={!enabled} className="mt-1 size-4" />
        <span className="text-sm">{t("confirm")}</span>
      </label>
      <Button type="submit" pending={pending} disabled={!hydrated || !enabled} className="self-start">
        {t("splitNow")}
      </Button>
    </form>
  );
}

export function RetryReceiptsForm() {
  const t = useTranslations("Donations");
  const [state, action, pending] = useActionState(retryReceiptsAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      {state.status === "done" && state.info && <Alert>{t("retried", { requeued: state.info.requeued ?? 0, sent: state.info.sent ?? 0 })}</Alert>}
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start">
        {t("retry")}
      </Button>
    </form>
  );
}
