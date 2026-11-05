"use client";
/**
 * Action forms on the admin store page. Which ones appear depends on the store's status;
 * the server enforces the same rules atomically (a stale page can't, e.g., approve a store
 * that was rejected meanwhile: it gets "badStatus").
 *
 * After a successful action the page re-renders with the new status, which swaps the forms.
 * The confirmation therefore lives in THIS component (it survives the swap) in a role=status
 * region that receives focus, so sighted and screen-reader users both get feedback.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import {
  approveAction,
  cancelInviteAction,
  discountAction,
  reinstateAction,
  rejectAction,
  resendInviteAction,
  suspendAction,
} from "../actions";
import { INITIAL_ADMIN_STATE, type AdminFormState } from "../admin-form-state";

type Action = (prev: AdminFormState, fd: FormData) => Promise<AdminFormState>;

function ActionForm({
  action,
  storeId,
  title,
  submit,
  doneMessage,
  onDone,
  variant = "primary",
  children,
}: {
  action: Action;
  storeId: string;
  title: string;
  submit: string;
  doneMessage: string;
  onDone: (message: string, state: AdminFormState) => void;
  variant?: "primary" | "secondary";
  children?: (state: AdminFormState) => React.ReactNode;
}) {
  const t = useTranslations("StoreAdmin");
  const locale = useLocale();
  // Report success from INSIDE the action call: if the status changes, this form is removed
  // in the same render, so an effect here would never run (found by the browser E2E).
  const reporting: Action = async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.status === "done") onDone(result.emailFailed ? t("emailFailedNotice") : doneMessage, result);
    return result;
  };
  const [state, formAction, pending] = useActionState(reporting, INITIAL_ADMIN_STATE);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-3 rounded-xl border border-foreground/15 p-4">
      <h3 className="font-semibold">{title}</h3>
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="locale" value={locale} />
      {children?.(state)}
      <Button type="submit" variant={variant} pending={pending} disabled={!hydrated}>
        {submit}
      </Button>
    </form>
  );
}

function DiscountField({ state, defaultValue }: { state: AdminFormState; defaultValue?: string }) {
  const t = useTranslations("StoreAdmin");
  const fieldError = useFieldError();
  return (
    <TextField
      label={t("discountLabel")}
      name="discount"
      inputMode="decimal"
      required
      pattern="\d{1,2}(\.\d{1,2})?"
      hint={t("discountHint")}
      defaultValue={state.values?.discount ?? defaultValue}
      error={fieldError(state.fieldErrors?.discount)}
    />
  );
}

function ReasonField({ state, label, id }: { state: AdminFormState; label: string; id: string }) {
  const fieldError = useFieldError();
  const err = fieldError(state.fieldErrors?.reason);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        name="reason"
        required
        minLength={3}
        maxLength={500}
        rows={3}
        defaultValue={state.values?.reason}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? `${id}-error` : undefined}
        className={`rounded-lg border bg-background px-3 py-2 ${err ? "border-danger" : "border-input"}`}
      />
      {err && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {err}
        </p>
      )}
    </div>
  );
}

export function StoreActions({
  storeId,
  status,
  discountPercent,
  ownerVerified,
}: {
  storeId: string;
  status: string;
  discountPercent?: string;
  ownerVerified: boolean;
}) {
  const t = useTranslations("StoreAdmin");
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const onDone = (message: string) => setNotice(message);
  useEffect(() => {
    if (notice) noticeRef.current?.focus(); // move focus so screen readers read it
  }, [notice]);

  return (
    <div className="flex flex-col gap-4">
      <div ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {notice && <Alert>{notice}</Alert>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(status === "pending" || status === "rejected") &&
          (ownerVerified ? (
            <ActionForm action={approveAction} storeId={storeId} title={t("approveTitle")} submit={t("approve")} doneMessage={t("doneApprove")} onDone={onDone}>
              {(s) => <DiscountField state={s} defaultValue={discountPercent} />}
            </ActionForm>
          ) : (
            <div className="rounded-xl border border-foreground/15 p-4 text-sm">
              <h3 className="mb-2 font-semibold">{t("approveTitle")}</h3>
              <p>{t("ownerUnverifiedNote")}</p>
            </div>
          ))}
        {status === "pending" && (
          <ActionForm action={rejectAction} storeId={storeId} title={t("rejectTitle")} submit={t("reject")} doneMessage={t("doneReject")} onDone={onDone} variant="secondary">
            {(s) => <ReasonField state={s} label={ownerVerified ? t("rejectReason") : t("rejectReasonNoEmail")} id="reject-reason" />}
          </ActionForm>
        )}
        {status === "approved" && (
          <ActionForm action={suspendAction} storeId={storeId} title={t("suspendTitle")} submit={t("suspend")} doneMessage={t("doneSuspend")} onDone={onDone} variant="secondary">
            {(s) => <ReasonField state={s} label={t("suspendReason")} id="suspend-reason" />}
          </ActionForm>
        )}
        {status === "suspended" && (
          <ActionForm action={reinstateAction} storeId={storeId} title={t("reinstateTitle")} submit={t("reinstate")} doneMessage={t("doneReinstate")} onDone={onDone} />
        )}
        {status === "invited" && (
          <>
            <ActionForm action={resendInviteAction} storeId={storeId} title={t("resendTitle")} submit={t("resend")} doneMessage={t("doneResend")} onDone={onDone} />
            <ActionForm
              action={cancelInviteAction}
              storeId={storeId}
              title={t("cancelInviteTitle")}
              submit={t("cancelInvite")}
              doneMessage={t("doneCancel")}
              onDone={() => router.replace({ pathname: "/stores", query: { status: "invited" } })}
              variant="secondary"
            />
          </>
        )}
        {(status === "approved" || status === "suspended" || status === "invited") && (
          <ActionForm action={discountAction} storeId={storeId} title={t("discountTitle")} submit={t("saveDiscount")} doneMessage={t("doneDiscount")} onDone={onDone} variant="secondary">
            {(s) => <DiscountField state={s} defaultValue={discountPercent} />}
          </ActionForm>
        )}
      </div>
    </div>
  );
}
