"use client";
/**
 * Buttons on the admin user page. Which ones show is decided by the page from the user's
 * current state; the server re-checks everything (@repo/auth/admin-users).
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { TextField } from "@repo/ui/text-field";
import { useHydrated } from "@repo/ui/use-hydrated";
import { userAction, type UserFormState } from "./actions";

const INITIAL: UserFormState = { status: "idle" };

export type UserOps = { suspend: boolean; reinstate: boolean; unlock: boolean; signOut: boolean; resetMfa: boolean };

export function UserActions({ userId, ops, email }: { userId: string; ops: UserOps; email: string }) {
  const t = useTranslations("Users");
  const [state, action, pending] = useActionState(userAction, INITIAL);
  const hydrated = useHydrated();
  const button = (op: Exclude<keyof UserOps, "suspend">, variant: "primary" | "secondary" = "secondary") =>
    ops[op] && (
      <form action={action}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="op" value={op} />
        <Button type="submit" variant={variant} pending={pending} disabled={!hydrated}>
          {t(`ops.${op}`)}
        </Button>
        <p className="mt-1 text-sm text-foreground/70">{t(`ops.${op}Help`)}</p>
      </form>
    );
  return (
    <div className="flex flex-col gap-4">
      {state.status === "done" && state.done && <Alert>{t(`done.${state.done}` as never)}</Alert>}
      {state.status === "error" && state.error && <Alert tone="error">{t(`errors.${state.error}` as never)}</Alert>}
      {ops.suspend && (
        // Re-mount (clear the reason) only after SUCCESS: an error keeps what the admin typed.
        <form key={state.status === "done" ? state.nonce : "suspend"} action={action} className="flex flex-col gap-2">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="op" value="suspend" />
          <TextField label={t("reasonLabel", { email })} hint={t("reasonHint")} name="reason" required minLength={3} maxLength={500} />
          <Button type="submit" pending={pending} disabled={!hydrated} className="self-start">
            {t("ops.suspend")}
          </Button>
        </form>
      )}
      {button("reinstate", "primary")}
      {button("unlock")}
      {button("signOut")}
      {button("resetMfa")}
    </div>
  );
}
