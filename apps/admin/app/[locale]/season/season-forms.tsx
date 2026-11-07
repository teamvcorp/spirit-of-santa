"use client";
/**
 * The three season controls. Every rule is enforced on the server (@repo/stores/season); these
 * forms only make the choices clear. Submit stays disabled until hydration (see CODEMAP
 * "Forms + Cache Components"); after an action the page re-renders with the saved values.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { datesAction, forceFreezeAction, runResetAction, storeWindowAction, type SeasonFormState } from "./actions";

const INITIAL: SeasonFormState = { status: "idle" };

function Result({ state }: { state: SeasonFormState }) {
  const t = useTranslations("Season");
  if (state.status === "done") return <Alert>{t("saved")}</Alert>;
  if (state.status === "error" && state.error) return <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>;
  return null;
}

export function StoreWindowForm({ mode }: { mode: "auto" | "open" | "closed" }) {
  const t = useTranslations("Season");
  const [state, action, pending] = useActionState(storeWindowAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      <Result state={state} />
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t("windowTitle")}</legend>
        {(["auto", "open", "closed"] as const).map((m) => (
          <label key={m} className="flex items-start gap-2">
            <input type="radio" name="mode" value={m} defaultChecked={mode === m} className="mt-1 size-4" />
            <span>
              <span className="font-semibold">{t(`window.${m}`)}</span>
              <span className="block text-sm text-muted">{t(`window.${m}Help`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("saveWindow")}
      </Button>
    </form>
  );
}

/** `canFreeze`: only while the season is open (server enforces it too). */
export function ForceFreezeForm({ on, canFreeze }: { on: boolean; canFreeze: boolean }) {
  const t = useTranslations("Season");
  const [state, action, pending] = useActionState(forceFreezeAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      <Result state={state} />
      <input type="hidden" name="on" value={on ? "false" : "true"} />
      {!on && !canFreeze && <p className="text-sm text-muted">{t("freezeOnlyOpen")}</p>}
      {!on && canFreeze && (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="confirm" value="yes" required className="mt-1 size-4" />
          <span className="text-sm">{t("freezeConfirm")}</span>
        </label>
      )}
      {(on || canFreeze) && (
        <Button type="submit" variant={on ? "secondary" : "primary"} pending={pending} disabled={!hydrated} className="self-start">
          {on ? t("unfreeze") : t("freezeNow")}
        </Button>
      )}
    </form>
  );
}

/** Open is always Jan 1 (year-round calendar): only freeze and the first closed day are editable. */
type Dates = { freezeDate: string; closeDate: string };

export function DatesForm({ year, custom, defaults, locked }: { year: number; custom: Dates; defaults: { open: string; freeze: string; close: string }; locked: boolean }) {
  const t = useTranslations("Season");
  const [state, action, pending] = useActionState(datesAction, INITIAL);
  const hydrated = useHydrated();
  const field = (name: keyof Dates, def: string) => (
    <TextField
      label={t(`dates.${name}`)}
      hint={t("dates.defaultHint", { date: def })}
      name={name}
      type="date"
      min={`${year}-01-01`}
      max={`${year}-12-31`}
      defaultValue={state.status === "error" && state.values ? (state.values[name] ?? "") : custom[name]}
      disabled={locked}
    />
  );
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      <Result state={state} />
      <input type="hidden" name="year" value={year} />
      {field("freezeDate", defaults.freeze)}
      {field("closeDate", defaults.close)}
      <p className="text-sm text-muted">{t("dates.blankHelp")}</p>
      {!locked && (
        <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
          {t("dates.save", { year })}
        </Button>
      )}
    </form>
  );
}

/** Shown only while the season is "resetting": re-run the Jan 1 reset by hand (e.g. the cron timed out). */
export function RunResetForm() {
  const t = useTranslations("Season");
  const [state, action, pending] = useActionState(runResetAction, INITIAL);
  const hydrated = useHydrated();
  return (
    <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
      <Result state={state} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" required className="mt-1 size-4" />
        {t("resetConfirm")}
      </label>
      <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
        {t("resetRun")}
      </Button>
    </form>
  );
}
