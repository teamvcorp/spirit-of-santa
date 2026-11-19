"use client";
/**
 * FOUNDING PARTNER FEE card on the admin store page (owner 2026-11-18). A business payment, never a donation.
 * Set the amount (store becomes "fee due": it can't be approved until paid or waived), clear it, record a payment
 * that arrived (check / ACH / wire), or waive it with a reason. Server rules: @repo/stores/partner-fee.
 * Same feedback pattern as StoreActions: the notice lives here (it survives the forms swapping) and takes focus.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { PARTNER_FEE_METHODS } from "@repo/lib/limits";
import { Alert } from "@repo/ui/alert";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";
import { Link } from "@/i18n/navigation";
import { clearFeeAction, feePaidAction, setFeeAction, waiveFeeAction } from "../actions";
import { ActionForm, ReasonField } from "./store-actions";

export type FeeCardView = {
  status: "not_required" | "due" | "paid" | "waived";
  settable: boolean;
  amount?: string; // formatted, e.g. "$50,000.00"
  amountInput?: string; // for the form, e.g. "50000"
  amountCents?: number; // the amount shown: "mark paid" must match it (another admin may change it meanwhile)
  invoiceNo?: string;
  paidLine?: string; // "Paid on Nov 19, 2026 by check (ref 1042)"
  waivedReason?: string;
};

export function PartnerFeeCard({ storeId, view, today }: { storeId: string; view: FeeCardView; today: string }) {
  const t = useTranslations("StoreAdmin.fee");
  const fieldError = useFieldError();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const onDone = (message: string) => setNotice(message);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  return (
    <div className="flex flex-col gap-4" data-testid="partner-fee">
      <p className="text-sm text-muted">{t("intro")}</p>
      <div ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {notice && <Alert>{notice}</Alert>}
      </div>
      <p className="font-semibold" data-testid="fee-status">
        {view.status === "due" ? t("statusDue", { amount: view.amount ?? "" }) : view.status === "paid" ? view.paidLine : view.status === "waived" ? t("statusWaived") : t("statusNone")}
      </p>
      {view.status === "waived" && view.waivedReason && <p className="text-sm">{t("waivedBecause", { reason: view.waivedReason })}</p>}
      {view.invoiceNo && view.status !== "not_required" && (
        <Link href={`/stores/${storeId}/invoice`} className="text-sm underline underline-offset-4">
          {t("openInvoice", { invoiceNo: view.invoiceNo })}
        </Link>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {view.settable && (
          <ActionForm action={setFeeAction} storeId={storeId} title={view.status === "due" ? t("changeTitle") : t("setTitle")} submit={t("set")} doneMessage={t("doneSet")} onDone={onDone}>
            {(s) => (
              <TextField
                label={t("amountLabel")}
                name="amount"
                inputMode="decimal"
                required
                hint={t("amountHint")}
                defaultValue={s.values?.amount ?? view.amountInput ?? "50000"}
                error={fieldError(s.fieldErrors?.amount)}
              />
            )}
          </ActionForm>
        )}
        {view.status === "due" && (
          <>
            <ActionForm action={feePaidAction} storeId={storeId} title={t("paidTitle")} submit={t("markPaid")} doneMessage={t("donePaid")} onDone={onDone}>
              {(s) => (
                <>
                  <input type="hidden" name="expectedAmountCents" value={view.amountCents ?? ""} />
                  <TextField label={t("paidOn")} name="paidOn" type="date" required max={today} defaultValue={s.values?.paidOn ?? today} error={fieldError(s.fieldErrors?.paidOn)} />
                  <SelectField label={t("via")} name="via" required defaultValue={s.values?.via ?? "check"} error={fieldError(s.fieldErrors?.via)}>
                    {PARTNER_FEE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`methods.${m}`)}
                      </option>
                    ))}
                  </SelectField>
                  <TextField label={t("reference")} name="reference" maxLength={120} hint={t("referenceHint")} defaultValue={s.values?.reference ?? ""} error={fieldError(s.fieldErrors?.reference)} />
                </>
              )}
            </ActionForm>
            <ActionForm action={waiveFeeAction} storeId={storeId} title={t("waiveTitle")} submit={t("waive")} doneMessage={t("doneWaive")} onDone={onDone} variant="secondary">
              {(s) => <ReasonField state={s} label={t("waiveReason")} id="waive-reason" />}
            </ActionForm>
            <ActionForm action={clearFeeAction} storeId={storeId} title={t("clearTitle")} submit={t("clear")} doneMessage={t("doneClear")} onDone={onDone} variant="secondary" />
          </>
        )}
      </div>
    </div>
  );
}
