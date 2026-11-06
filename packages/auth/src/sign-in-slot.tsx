/**
 * Sign-in form with URL params, Cache Components–friendly (Server Component).
 *
 * The page shell (and a param-free form as the Suspense fallback) is prerendered, so the
 * form appears instantly and without JavaScript. Reading `searchParams` is request-time,
 * so only this small part streams in, replacing the fallback with a form that knows
 * ?callbackUrl (validated here against open redirects) and ?error.
 *
 *   <SignInSlot searchParams={props.searchParams} />
 */
import { Suspense } from "react";
import { safeCallbackPath } from "./redirect.ts";
import { SignInForm } from "./sign-in-form.tsx";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function SignInFormWithParams({ searchParams, showCode }: { searchParams: SearchParams; showCode: boolean }) {
  const params = await searchParams;
  return (
    <SignInForm
      callbackUrl={safeCallbackPath(first(params.callbackUrl))}
      showError={Boolean(first(params.error))}
      showCode={showCode}
    />
  );
}

/** `showCode`: add the authenticator-code field (admin app, MFA). */
export function SignInSlot({ searchParams, showCode = false }: { searchParams: SearchParams; showCode?: boolean }) {
  return (
    <Suspense fallback={<SignInForm showCode={showCode} />}>
      <SignInFormWithParams searchParams={searchParams} showCode={showCode} />
    </Suspense>
  );
}
