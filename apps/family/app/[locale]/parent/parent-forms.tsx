"use client";
/** Parent-area forms. Every rule is re-checked on the server (actions.ts + @repo/families). */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LocaleField, useFieldError } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { aliasAction, deleteKidAction, saveKidAction, setPinAction, unlockAction, voteAction, type ParentFormState } from "./actions";

const INITIAL: ParentFormState = { status: "idle" };

function useErr(state: ParentFormState) {
  const t = useTranslations("Parent");
  const fieldError = useFieldError();
  return (k: string) => {
    const code = state.fieldErrors?.[k];
    if (!code) return undefined;
    return code === "pinMismatch" || code === "invalidYear" || code === "invalidCap" ? t(`errors.${code}`) : fieldError(code);
  };
}

export function PinSetupForm() {
  const t = useTranslations("Parent");
  const [state, action, pending] = useActionState(setPinAction, INITIAL);
  const hydrated = useHydrated();
  const err = useErr(state);
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      <LocaleField />
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <TextField label={t("password")} hint={t("passwordHint")} name="password" type="password" autoComplete="current-password" required maxLength={256} />
      <TextField label={t("newPin")} hint={t("pinHint")} name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,6}" minLength={4} maxLength={6} required />
      <TextField label={t("confirmPin")} name="pinConfirm" type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,6}" minLength={4} maxLength={6} required error={err("pinConfirm")} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("savePin")}
      </Button>
    </form>
  );
}

export function UnlockForm() {
  const t = useTranslations("Parent");
  const [state, action, pending] = useActionState(unlockAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      <LocaleField />
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <TextField label={t("pin")} name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,6}" minLength={4} maxLength={6} required autoFocus />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("unlock")}
      </Button>
    </form>
  );
}

export type KidValues = { firstName: string; birthYear: string; displayName: string; itemCap: string };

export function KidForm({ id, initial, minYear, maxYear }: { id?: string; initial: KidValues; minYear: number; maxYear: number }) {
  const t = useTranslations("Parent");
  const [state, action, pending] = useActionState(saveKidAction, INITIAL);
  const hydrated = useHydrated();
  const err = useErr(state);
  const v = (k: keyof KidValues) => state.values?.[k] ?? initial[k];
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      <LocaleField />
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      {id && <input type="hidden" name="id" value={id} />}
      <TextField label={t("firstName")} hint={t("firstNameHint")} name="firstName" autoComplete="off" required maxLength={40} defaultValue={v("firstName")} error={err("firstName")} />
      <TextField label={t("birthYear")} hint={t("birthYearHint")} name="birthYear" inputMode="numeric" required min={minYear} max={maxYear} type="number" defaultValue={v("birthYear")} error={err("birthYear")} />
      <TextField label={t("displayName")} hint={t("displayNameHint")} name="displayName" autoComplete="off" maxLength={20} defaultValue={v("displayName")} error={err("displayName")} />
      <TextField label={t("itemCap")} hint={t("itemCapHint")} name="itemCap" type="number" inputMode="numeric" min={0} max={50} required defaultValue={v("itemCap")} error={err("itemCap")} />
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {id ? t("saveKid") : t("addKid")}
      </Button>
    </form>
  );
}

export function DeleteKidForm({ id, name }: { id: string; name: string }) {
  const t = useTranslations("Parent");
  const [state, action, pending] = useActionState(deleteKidAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-2">
      <LocaleField />
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <input type="hidden" name="id" value={id} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" required className="mt-1 size-4" />
        {t("deleteConfirm", { name })}
      </label>
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start">
        {t("deleteKid")}
      </Button>
    </form>
  );
}

/** Today's vote: two buttons; the current one is marked (aria-pressed) so it's clear to everyone. */
export function VoteButtons({ kidId, name, today }: { kidId: string; name: string; today?: "nice" | "naughty" }) {
  const t = useTranslations("Parent");
  const [state, action, pending] = useActionState(voteAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2" role="group" aria-label={t("voteFor", { name })}>
        {(["nice", "naughty"] as const).map((v) => (
          <form key={v} action={action}>
            <input type="hidden" name="kidId" value={kidId} />
            <input type="hidden" name="vote" value={v} />
            <Button type="submit" variant={today === v ? "primary" : "secondary"} aria-pressed={today === v} pending={pending} disabled={!hydrated} className="min-h-9 px-3 py-1 text-sm">
              {t(`vote.${v}`)}
            </Button>
          </form>
        ))}
      </div>
      {state.status === "error" && state.error && <span role="alert" className="text-sm text-danger">{t(`errors.${state.error}` as never)}</span>}
    </div>
  );
}

export function AliasForm({ alias, show }: { alias: string; show: boolean }) {
  const t = useTranslations("Parent");
  const [state, action, pending] = useActionState(aliasAction, INITIAL);
  const hydrated = useHydrated();
  const err = useErr(state);
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      {state.status === "done" && <Alert>{t("aliasSaved")}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <TextField label={t("aliasLabel")} hint={t("aliasHint")} name="alias" maxLength={40} autoComplete="off" defaultValue={state.values?.alias ?? alias} error={err("alias")} />
      <label className="flex items-center gap-2">
        <input type="checkbox" name="show" defaultChecked={state.values ? state.values.show === "on" : show} className="size-5" />
        {t("aliasShow")}
      </label>
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start">
        {t("aliasSave")}
      </Button>
    </form>
  );
}
