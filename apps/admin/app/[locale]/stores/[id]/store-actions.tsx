"use client";
/**
 * Action forms on the admin store page. Which ones appear depends on the store's status;
 * the server enforces the same rules atomically (a stale page can't, e.g., approve a store
 * that was rejected meanwhile: it gets "badStatus").
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { approveAction, discountAction, reinstateAction, rejectAction, suspendAction } from "../actions";
import { INITIAL_ADMIN_STATE, type AdminFormState } from "../admin-form-state";

type Action = (prev: AdminFormState, fd: FormData) => Promise<AdminFormState>;

function ActionForm({
  action,
  storeId,
  title,
  submit,
  variant = "primary",
  children,
}: {
  action: Action;
  storeId: string;
  title: string;
  submit: string;
  variant?: "primary" | "secondary";
  children?: (state: AdminFormState) => React.ReactNode;
}) {
  const t = useTranslations("StoreAdmin");
  const [state, formAction, pending] = useActionState(action, INITIAL_ADMIN_STATE);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-3 rounded-xl border border-foreground/15 p-4">
      <h3 className="font-semibold">{title}</h3>
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      {state.status === "done" && <Alert>{t("saved")}</Alert>}
      <input type="hidden" name="storeId" value={storeId} />
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

function ReasonField({ state, label }: { state: AdminFormState; label: string }) {
  const fieldError = useFieldError();
  const err = fieldError(state.fieldErrors?.reason);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="reason" className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id="reason"
        name="reason"
        required
        minLength={3}
        maxLength={500}
        rows={3}
        defaultValue={state.values?.reason}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? "reason-error" : undefined}
        className={`rounded-lg border bg-background px-3 py-2 ${err ? "border-danger" : "border-input"}`}
      />
      {err && (
        <p id="reason-error" className="text-sm text-danger">
          {err}
        </p>
      )}
    </div>
  );
}

export function StoreActions({ storeId, status, discountPercent }: { storeId: string; status: string; discountPercent?: string }) {
  const t = useTranslations("StoreAdmin");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(status === "pending" || status === "rejected") && (
        <ActionForm action={approveAction} storeId={storeId} title={t("approveTitle")} submit={t("approve")}>
          {(s) => <DiscountField state={s} defaultValue={discountPercent} />}
        </ActionForm>
      )}
      {status === "pending" && (
        <ActionForm action={rejectAction} storeId={storeId} title={t("rejectTitle")} submit={t("reject")} variant="secondary">
          {(s) => <ReasonField state={s} label={t("rejectReason")} />}
        </ActionForm>
      )}
      {status === "approved" && (
        <ActionForm action={suspendAction} storeId={storeId} title={t("suspendTitle")} submit={t("suspend")} variant="secondary">
          {(s) => <ReasonField state={s} label={t("suspendReason")} />}
        </ActionForm>
      )}
      {status === "suspended" && <ActionForm action={reinstateAction} storeId={storeId} title={t("reinstateTitle")} submit={t("reinstate")} />}
      {(status === "approved" || status === "suspended" || status === "invited") && (
        <ActionForm action={discountAction} storeId={storeId} title={t("discountTitle")} submit={t("saveDiscount")} variant="secondary">
          {(s) => <DiscountField state={s} defaultValue={discountPercent} />}
        </ActionForm>
      )}
    </div>
  );
}