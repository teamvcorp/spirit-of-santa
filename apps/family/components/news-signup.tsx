"use client";
/**
 * "Get our news" form (owner 2026-11-12): email + an UNTICKED "I'm 18 or older and want news" box. After sending
 * it always says "check your inbox" (double opt-in: nothing happens until they click the link in that email, and
 * the answer is the same for an address that is already subscribed). Hidden honeypot field catches simple bots.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LocaleField } from "@repo/auth/forms";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { newsSignupAction, type NewsSignupState } from "@/app/[locale]/news/actions";

export function NewsSignup() {
  const t = useTranslations("News");
  const [state, action, pending] = useActionState(newsSignupAction, { status: "idle" } as NewsSignupState);
  const hydrated = useHydrated();

  if (state.status === "sent") return <Alert>{t("sent")}</Alert>;
  const error = state.status === "error" ? state.error : null;
  return (
    // key: remount after an error so the typed email comes back (React 19 resets forms after an action).
    <form key={state.status === "error" ? state.nonce : "initial"} action={action} className="flex flex-col gap-4" data-testid="news-form">
      {error && <Alert tone="error">{t(`errors.${error}`)}</Alert>}
      <LocaleField />
      <TextField label={t("email")} name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={state.status === "error" ? state.email : ""} />
      <label className="flex items-start gap-3">
        <input type="checkbox" name="adult" className="mt-1 size-5 shrink-0" required data-testid="news-adult" />
        <span>{t("optIn")}</span>
      </label>
      {/* Honeypot: off-screen and skipped by keyboard + screen readers; people never fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="company_url" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p className="text-sm text-muted">{t("note")}</p>
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {t("submit")}
      </Button>
    </form>
  );
}
