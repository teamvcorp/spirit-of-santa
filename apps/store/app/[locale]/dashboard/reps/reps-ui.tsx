"use client";
/** Invite a rep by email; remove a rep (they're signed out and lose access). */
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFieldError } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { inviteRepAction, removeRepAction } from "../actions";
import { INITIAL_DASH_STATE } from "../form-state";

export function InviteRepForm({ editable }: { editable: boolean }) {
  const t = useTranslations("Reps");
  const errorsT = useTranslations("Dashboard.errors");
  const fieldError = useFieldError();
  const locale = useLocale();
  const [state, formAction, pending] = useActionState(inviteRepAction, INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-3">
      {state.status === "done" && <Alert>{t("invited")}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error as never)}</Alert>}
      <TextField
        label={t("email")}
        name="email"
        type="email"
        required
        maxLength={254}
        disabled={!editable}
        defaultValue={state.status === "error" ? state.values?.email : undefined}
        error={fieldError(state.fieldErrors?.email)}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="language" className="text-sm font-medium">
          {t("language")}
        </label>
        <select id="language" name="language" defaultValue={locale} disabled={!editable} className="min-h-11 rounded-lg border border-input bg-background px-3 py-2">
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </div>
      <Button type="submit" pending={pending} disabled={!hydrated || !editable} className="self-start">
        {t("sendInvite")}
      </Button>
    </form>
  );
}

export function RemoveRepButton({ repId, name }: { repId: string; name: string }) {
  const t = useTranslations("Reps");
  const errorsT = useTranslations("Dashboard.errors");
  const [state, formAction, pending] = useActionState(removeRepAction, INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // Removing someone signs them out: ask first (keyboard + screen-reader friendly).
        if (!window.confirm(t("confirmRemove", { name }))) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <input type="hidden" name="repId" value={repId} />
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="min-h-9 px-3 text-sm">
        {t("remove")}
      </Button>
      {state.status === "error" && state.error && <span className="text-sm text-danger">{errorsT(state.error as never)}</span>}
    </form>
  );
}