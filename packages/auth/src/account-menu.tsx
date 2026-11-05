/**
 * Header account area (Server Component): "Signed in as … [Sign out]" or a "Sign in" link.
 *
 * It reads the session cookie, which is request-time data, so render it inside
 * <Suspense> in the layout. Everything else on the page can still be prerendered.
 */
import "server-only";
import { connection } from "next/server";
import type { AuthOptions } from "next-auth";
import { getLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@repo/lib/locales";
import { localizePath } from "@repo/i18n/paths";
import { getSessionUser } from "./guards.ts";
import { SignOutButton } from "./sign-out-button.tsx";

export async function AccountMenu({ authOptions }: { authOptions: AuthOptions }) {
  // Tell Next this is request-time BEFORE next-auth runs: getServerSession creates a random
  // CSRF token, and random values during prerender are an error under Cache Components.
  await connection();
  const [user, t, locale] = await Promise.all([
    getSessionUser(authOptions),
    getTranslations("Common"),
    getLocale(),
  ]);
  const home = isLocale(locale) ? localizePath("/", locale) : "/";

  if (!user) {
    const signInHref = isLocale(locale) ? localizePath("/signin", locale) : "/signin";
    return (
      <a href={signInHref} className="font-semibold underline">
        {t("actions.signIn")}
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="text-foreground/80">{t("auth.signedInAs", { email: user.email })}</span>
      <SignOutButton label={t("actions.signOut")} callbackUrl={home} />
    </div>
  );
}
