"use client";
/** Pick a deed from the catalog or describe it ("Other"). Rules are re-checked on the server. */
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { LocaleField, useFieldError } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { recordDeedAction, type DeedFormState } from "./actions";

const INITIAL: DeedFormState = { status: "idle" };

export function RecordDeedForm({ kidId, deeds }: { kidId: string; deeds: { id: string; title: string; description?: string }[] }) {
  const t = useTranslations("Kid");
  const fieldError = useFieldError();
  const [state, action, pending] = useActionState(recordDeedAction, INITIAL);
  const [choice, setChoice] = useState(state.values?.choice ?? "");
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <LocaleField />
      <input type="hidden" name="kidId" value={kidId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">{t("whichDeed")}</legend>
        {deeds.map((d) => (
          <label key={d.id} className="flex items-start gap-2 rounded-lg border border-foreground/15 p-3">
            <input type="radio" name="choice" value={d.id} required defaultChecked={state.values?.choice === d.id} onChange={() => setChoice(d.id)} className="mt-1 size-4" />
            <span>
              <span className="font-semibold">{d.title}</span>
              {d.description && <span className="block text-sm text-muted">{d.description}</span>}
            </span>
          </label>
        ))}
        <label className="flex items-start gap-2 rounded-lg border border-foreground/15 p-3">
          <input type="radio" name="choice" value="other" required defaultChecked={state.values?.choice === "other"} onChange={() => setChoice("other")} className="mt-1 size-4" />
          <span className="font-semibold">{t("other")}</span>
        </label>
      </fieldset>
      {choice === "other" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="other" className="text-sm font-medium">
            {t("otherLabel")}
          </label>
          <textarea
            id="other"
            name="other"
            rows={3}
            maxLength={280}
            required
            defaultValue={state.values?.other}
            aria-describedby="other-hint"
            aria-invalid={state.fieldError ? true : undefined}
            className="rounded-lg border border-input bg-background px-3 py-2"
          />
          <p id="other-hint" className="text-sm text-muted">
            {t("otherHint")}
          </p>
          {state.fieldError && <p className="text-sm text-danger">{fieldError(state.fieldError)}</p>}
        </div>
      )}
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("create")}
      </Button>
    </form>
  );
}
