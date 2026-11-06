"use client";
/** Deed catalog forms (admin). All rules are re-checked on the server (@repo/deeds). */
import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { useRouter } from "@/i18n/navigation";
import { deedListAction, saveDeedAction, seedDeedsAction, type DeedFormState } from "./actions";

const INITIAL: DeedFormState = { status: "idle" };

export type DeedValues = { titleEn: string; titleEs: string; descriptionEn: string; descriptionEs: string; tipMin: string; tipMax: string };

/** Create (no id) or edit. After a successful save, back to the list. */
export function DeedForm({ id, version, initial }: { id?: string; version?: string; initial: DeedValues }) {
  const t = useTranslations("Deeds");
  const f = useTranslations("Common.formErrors");
  const [state, action, pending] = useActionState(saveDeedAction, INITIAL);
  const hydrated = useHydrated();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "done") router.push("/deeds");
  }, [state, router]);
  const v = (k: keyof DeedValues) => (state.values?.[k] ?? initial[k]);
  const err = (k: string) => {
    const code = state.fieldErrors?.[k];
    if (!code) return undefined;
    return code === "invalidAmount" || code === "minAboveMax" ? t(`errors.${code}`) : f(code as never);
  };
  return (
    // Re-mount with echoed values after an error (React 19 resets forms after an action).
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-4">
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      {id && <input type="hidden" name="id" value={id} />}
      {version && <input type="hidden" name="version" value={version} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t("titleEn")} name="titleEn" required maxLength={100} defaultValue={v("titleEn")} error={err("titleEn")} />
        <TextField label={t("titleEs")} name="titleEs" required maxLength={100} defaultValue={v("titleEs")} error={err("titleEs")} lang="es" />
        <TextField label={t("descriptionEn")} hint={t("optional")} name="descriptionEn" maxLength={200} defaultValue={v("descriptionEn")} error={err("descriptionEn")} />
        <TextField label={t("descriptionEs")} hint={t("optional")} name="descriptionEs" maxLength={200} defaultValue={v("descriptionEs")} error={err("descriptionEs")} lang="es" />
        <TextField label={t("tipMin")} hint={t("tipHint")} name="tipMin" inputMode="decimal" maxLength={10} defaultValue={v("tipMin")} error={err("tipMin")} />
        <TextField label={t("tipMax")} hint={t("tipHint")} name="tipMax" inputMode="decimal" maxLength={10} defaultValue={v("tipMax")} error={err("tipMax")} />
      </div>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {id ? t("save") : t("add")}
      </Button>
    </form>
  );
}

/** ↑ / ↓ / on-off buttons for one row. */
export function DeedRowActions({ id, active, first, last, title }: { id: string; active: boolean; first: boolean; last: boolean; title: string }) {
  const t = useTranslations("Deeds");
  const [state, action, pending] = useActionState(deedListAction, INITIAL);
  const hydrated = useHydrated();
  const op = (name: "up" | "down" | "activate" | "deactivate", label: string, aria: string) => (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={name} />
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} aria-label={aria} className="min-h-9 px-3 py-1 text-sm">
        {label}
      </Button>
    </form>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!first && op("up", "↑", t("moveUp", { title }))}
      {!last && op("down", "↓", t("moveDown", { title }))}
      {active ? op("deactivate", t("turnOff"), t("turnOffFor", { title })) : op("activate", t("turnOn"), t("turnOnFor", { title }))}
      {state.status === "error" && state.error && <span role="alert" className="text-sm text-danger">{t(`errors.${state.error}` as never)}</span>}
    </div>
  );
}

export function SeedButton() {
  const t = useTranslations("Deeds");
  const [state, action, pending] = useActionState(seedDeedsAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start">
        {t("seed")}
      </Button>
    </form>
  );
}
