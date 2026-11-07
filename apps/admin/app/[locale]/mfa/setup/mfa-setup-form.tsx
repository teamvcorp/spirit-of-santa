"use client";
/**
 * MFA setup steps: scan the QR code (or type the key), confirm with a code, save the
 * recovery codes, sign in again. The recovery codes only ever live in this component's
 * state: they're gone once the page is left, by design.
 */
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { SignOutButton } from "@repo/auth/sign-out-button";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { confirmMfaAction, type MfaSetupState } from "./actions";

const INITIAL: MfaSetupState = { status: "idle" };

export function MfaSetupForm({ qrDataUrl, manualKey, issuer, account }: { qrDataUrl: string; manualKey: string; issuer: string; account: string }) {
  const t = useTranslations("MfaSetup");
  const [state, action, pending] = useActionState(confirmMfaAction, INITIAL);
  const [saved, setSaved] = useState(false);
  const hydrated = useHydrated();

  if (state.status === "done" && state.recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <Alert>{t("doneTitle")}</Alert>
        <p>{t("recoveryIntro")}</p>
        {/* Monospace + one per line: easy to copy into a password manager or print. */}
        <ol aria-label={t("recoveryLabel")} className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-foreground/15 p-4 font-mono">
          {state.recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-5" />
          {t("savedCheckbox")}
        </label>
        {saved ? <SignOutButton label={t("signInAgain")} callbackUrl="/signin" /> : <p className="text-sm text-muted">{t("saveFirst")}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-4 pl-5">
        <li>{t("step1")}</li>
        <li>
          <p>{t("step2")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL; next/image adds nothing here */}
          <img src={qrDataUrl} alt={t("qrAlt")} width={240} height={240} className="mt-2 rounded-lg bg-white p-2" />
          <p className="mt-2 text-sm">{t("manualLabel")}</p>
          <code className="mt-1 block break-all rounded bg-foreground/5 p-2 text-sm" data-testid="mfa-manual-key">
            {manualKey}
          </code>
          <p className="mt-1 text-sm text-muted">{t("accountLine", { issuer, account })}</p>
        </li>
        <li>
          <p className="mb-2">{t("step3")}</p>
          <form key={state.nonce ?? "initial"} action={action} className="flex flex-col gap-3">
            {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
            <TextField label={t("codeLabel")} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
            <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
              {pending ? t("confirming") : t("confirm")}
            </Button>
          </form>
        </li>
      </ol>
    </div>
  );
}
