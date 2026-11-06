"use client";
/**
 * Platform settings form. Every rule is enforced on the server (@repo/payments/settings); this form
 * only makes the choices clear. Keyed by nonce; defaults = saved settings, or the echoed typing
 * after an error (React 19 resets forms after an action).
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { saveSettingsAction, type SettingsFormState } from "./actions";

export type SettingsDefaults = { fee: string; legalName: string; ein: string; address: string; receipts: boolean; fromDay: string; shippingAddress: string };

export function SettingsForm({ saved }: { saved: SettingsDefaults }) {
  const t = useTranslations("Settings");
  const [state, action, pending] = useActionState(saveSettingsAction, { status: "idle" } as SettingsFormState);
  const hydrated = useHydrated();
  const v = state.values;
  const d = {
    fee: v?.fee ?? saved.fee,
    legalName: v?.legalName ?? saved.legalName,
    ein: v?.ein ?? saved.ein,
    address: v?.address ?? saved.address,
    receipts: v ? v.receipts === "on" : saved.receipts,
    fromDay: v?.fromDay ?? saved.fromDay,
    shippingAddress: v?.shippingAddress ?? saved.shippingAddress,
  };
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {state.status === "done" && <Alert>{state.sent ? t("savedSent", { count: state.sent }) : t("saved")}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <TextField label={t("fee")} hint={t("feeHint")} name="fee" inputMode="decimal" required maxLength={6} defaultValue={d.fee} />
      <h3 className="mt-2 font-semibold">{t("charityTitle")}</h3>
      <TextField label={t("legalName")} name="legalName" maxLength={120} defaultValue={d.legalName} />
      <TextField label={t("ein")} hint={t("einHint")} name="ein" maxLength={10} pattern="\d{2}-\d{7}" defaultValue={d.ein} />
      <TextField label={t("address")} name="address" maxLength={200} defaultValue={d.address} />
      <label className="flex items-start gap-2">
        <input type="checkbox" name="receipts" value="on" defaultChecked={d.receipts} className="mt-1 size-4" />
        <span>
          <span className="font-semibold">{t("receipts")}</span>
          <span className="block text-sm text-foreground/70">{t("receiptsHelp")}</span>
        </span>
      </label>
      <TextField label={t("fromDay")} hint={t("fromDayHint")} name="fromDay" type="date" defaultValue={d.fromDay} />
      <h3 className="mt-2 font-semibold">{t("shippingTitle")}</h3>
      <label className="flex flex-col gap-1">
        <span className="font-medium">{t("shippingAddress")}</span>
        <textarea name="shippingAddress" rows={4} maxLength={300} defaultValue={d.shippingAddress} className="rounded-lg border border-foreground/20 bg-background px-3 py-2" aria-describedby="shipping-hint" />
        <span id="shipping-hint" className="text-sm text-foreground/70">{t("shippingHint")}</span>
      </label>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("save")}
      </Button>
    </form>
  );
}
