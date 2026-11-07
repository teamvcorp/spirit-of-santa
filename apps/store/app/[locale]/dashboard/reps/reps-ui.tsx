"use client";
/**
 * Reps management UI: the current reps list (with Remove) and the invite form.
 * Success messages live in a role=status region that survives the refresh and gets focus;
 * errors are shown next to what failed (review finding 2026-11-05).
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { inviteRepAction, removeRepAction } from "../actions";
import { INITIAL_DASH_STATE, type DashFormState } from "../form-state";

type Action = (prev: DashFormState, fd: FormData) => Promise<DashFormState>;
const reporting = (action: Action, onDone: () => void): Action => async (prev, fd) => {
  const result = await action(prev, fd);
  if (result.status === "done") onDone();
  return result;
};

/** role=status region that takes focus when a message appears. */
function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  const region = (
    <div ref={ref} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
      {notice && <Alert>{notice}</Alert>}
    </div>
  );
  return { region, setNotice };
}

export function InviteRepForm({ canInvite }: { canInvite: boolean }) {
  const t = useTranslations("Reps");
  const errorsT = useTranslations("Dashboard.errors");
  const fieldError = useFieldError();
  const locale = useLocale();
  const { region, setNotice } = useNotice();
  const [state, formAction, pending] = useActionState(reporting(inviteRepAction, () => setNotice(t("invited"))), INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  return (
    <div className="flex flex-col gap-3">
      {region}
      {!canInvite && <Alert>{t("inviteNeedsApproval")}</Alert>}
      <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-3">
        {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error as never)}</Alert>}
        <TextField
          label={t("email")}
          name="email"
          type="email"
          required
          maxLength={254}
          disabled={!canInvite}
          defaultValue={state.status === "error" ? state.values?.email : undefined}
          error={fieldError(state.fieldErrors?.email)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="language" className="text-sm font-medium">
            {t("language")}
          </label>
          <select id="language" name="language" defaultValue={locale} disabled={!canInvite} className="min-h-11 rounded-lg border border-input bg-background px-3 py-2">
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>
        <Button type="submit" pending={pending} disabled={!hydrated || !canInvite} className="self-start">
          {t("sendInvite")}
        </Button>
      </form>
    </div>
  );
}

function RemoveRepButton({ repId, name, onDone }: { repId: string; name: string; onDone: () => void }) {
  const t = useTranslations("Reps");
  const errorsT = useTranslations("Dashboard.errors");
  const [state, formAction, pending] = useActionState(reporting(removeRepAction, onDone), INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Removing someone signs them out: ask first (keyboard + screen-reader friendly).
        if (!window.confirm(t("confirmRemove", { name }))) e.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="repId" value={repId} />
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} size="sm" aria-label={`${t("remove")}: ${name}`}>
        {t("remove")}
      </Button>
      {state.status === "error" && state.error && (
        <p role="alert" className="text-sm text-danger">
          {errorsT(state.error as never)}
        </p>
      )}
    </form>
  );
}

export function RepsList({ reps }: { reps: { id: string; name?: string; email: string }[] }) {
  const t = useTranslations("Reps");
  const { region, setNotice } = useNotice();
  return (
    <div className="flex flex-col gap-3">
      {region}
      {reps.length === 0 ? (
        <p className="text-sm text-foreground/70">{t("none")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-foreground/10">
          {reps.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{r.name ?? r.email}</span>
                {r.name && <span className="block text-sm text-foreground/70">{r.email}</span>}
              </span>
              <RemoveRepButton repId={r.id} name={r.name ?? r.email} onDone={() => setNotice(t("removed"))} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
