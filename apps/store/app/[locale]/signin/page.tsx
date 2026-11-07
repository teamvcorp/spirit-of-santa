import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignInSlot } from "@repo/auth/sign-in-slot";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Common.auth");
  // No reason for search engines to index a login form.
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function SignInPage({ searchParams }: PageProps<"/[locale]/signin">) {
  const [auth, page, links] = await Promise.all([
    getTranslations("Common.auth"),
    getTranslations("SignInPage"),
    getTranslations("Common.accounts.links"),
  ]);
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{auth("title")}</h1>
        <p className="mb-6 mt-1 text-muted">{page("intro")}</p>
        {/* Prerendered form; ?callbackUrl / ?error stream in (see sign-in-slot.tsx). */}
        <SignInSlot searchParams={searchParams} />
        <div className="mt-6 flex flex-col gap-2 text-sm">
          <Link href="/forgot-password" className="underline underline-offset-4">{links("forgot")}</Link>
          <Link href="/verify/resend" className="underline underline-offset-4">{links("resend")}</Link>
          <span>
            {page("noAccount")}{" "}
            <Link href="/register" className="font-semibold underline underline-offset-4">{page("register")}</Link>
          </span>
        </div>
      </Card>
    </main>
  );
}
