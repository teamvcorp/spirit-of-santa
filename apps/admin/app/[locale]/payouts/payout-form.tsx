"use client";
/** "Record payment" for one store: how it was paid + a confirmation box naming the exact amount. */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { formatCents } from "@repo/lib/format";
import { LocaleField } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { recordPayoutAction, type PayoutFormState } from "./actions";

const METHODS = ["check", "bank_transfer", "other"] as const;
const IDLE: PayoutFormState = { status: "idle" };
const input = "rounded-lg border border-foreground/20 bg-background px-3 py-2";

export function PayoutForm({ storeId, storeName, owedCents, today }: { storeId: string; storeName: string; owedCents: number; today: string }) {
  const t = useTranslations("Payouts");
  const [state, action, pending] = useActionState(recordPayoutAction, IDLE);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-3" aria-label={t("formFor", { store: storeName })}>
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <LocaleField />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="seenCents" value={owedCents} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("method")}</span>
          <select name="method" defaultValue="check" className={input}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`methods.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("reference")}</span>
          <input name="reference" maxLength={60} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t("paidOn")}</span>
          <input name="paidOn" type="date" required defaultValue={today} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("note")}</span>
        <input name="note" maxLength={300} className={input} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="on" required className="mt-1 size-4" />
        <span>{t("confirm", { amount: formatCents(owedCents), store: storeName })}</span>
      </label>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("record")}
      </Button>
    </form>
  );
}
