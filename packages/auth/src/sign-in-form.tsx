"use client";
/**
 * Email + password sign-in form, shared by all three apps (each app's NextAuth config
 * decides which roles may get in).
 *
 * Flow: next-auth/react signIn() fetches a CSRF token, POSTs to /api/auth/callback/
 * credentials, and returns { ok, error } instead of redirecting (redirect: false), so we
 * can show a translated message. On success we navigate to a *validated* callbackUrl.
 *
 * Security notes:
 *  - One generic message for every failure (wrong password, unknown email, locked,
 *    wrong app): telling them apart would let attackers discover which emails exist.
 *  - The password never touches React state or the URL; it's read from the form on submit.
 *    The form is server-rendered, so before JavaScript loads a submit would be a NATIVE
 *    submit. Two guards (found in review): method="post" (a native submit can never put
 *    the password in the URL, history or access logs), and the button stays disabled
 *    until hydration, so nobody sends a request that can't work anyway.
 *  - No useSearchParams (that would make the form client-only and blank until JS loads).
 *    The server validates ?callbackUrl / ?error and passes them in: see sign-in-slot.tsx.
 */
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { safeCallbackPath } from "./redirect.ts";

export function SignInForm({
  callbackUrl = "/",
  showError = false,
}: {
  /** Already validated on the server; re-checked here anyway (defence in depth). */
  callbackUrl?: string;
  showError?: boolean;
}) {
  const t = useTranslations("Common.auth");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // next-auth appends ?error=... when it redirects here itself (e.g. expired CSRF token).
  const [failed, setFailed] = useState(showError);
  const hydrated = useHydrated();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailed(false);
    const form = new FormData(event.currentTarget);
    try {
      const result = await signIn("credentials", {
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        redirect: false,
      });
      if (result?.ok && !result.error) {
        router.replace(safeCallbackPath(callbackUrl));
        router.refresh(); // re-render server components with the new session
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true); // network error: same generic message
    }
    setPending(false);
  }

  return (
    <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4">
      {failed && <Alert tone="error">{t("failed")}</Alert>}
      <TextField
        label={t("email")}
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        maxLength={254}
      />
      <TextField
        label={t("password")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={256}
      />
      <Button type="submit" pending={pending} disabled={!hydrated}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

const noopSubscribe = () => () => {};
/** false during server render and hydration, true once React runs in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}
