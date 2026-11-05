/**
 * Reads ?token= from the URL and renders the matching form. SERVER component.
 * Wrap it in <Suspense> in the page: reading searchParams is request-time data under
 * Cache Components, so the page shell stays prerendered and this part streams in.
 * The token is NOT checked here (that would need a DB call on every view and would leak
 * "valid/invalid" before the user acts); the Server Action checks it on submit.
 */
import type { FormState } from "./form-state.ts";
import { ConfirmEmailForm, ResetPasswordForm } from "./forms.tsx";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export async function TokenFormSlot({
  searchParams,
  kind,
  action,
  signInHref,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  kind: "reset" | "verify";
  action: Action;
  signInHref: string;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw.slice(0, 100) : "";
  return kind === "reset" ? (
    <ResetPasswordForm action={action} token={token} signInHref={signInHref} />
  ) : (
    <ConfirmEmailForm action={action} token={token} signInHref={signInHref} />
  );
}
