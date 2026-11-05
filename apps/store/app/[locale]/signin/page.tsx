import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignInSlot } from "@repo/auth/sign-in-slot";
import { Card } from "@repo/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Common.auth");
  // No reason for search engines to index a login form.
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function SignInPage({ searchParams }: PageProps<"/[locale]/signin">) {
  const [auth, page] = await Promise.all([
    getTranslations("Common.auth"),
    getTranslations("SignInPage"),
  ]);
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{auth("title")}</h1>
        <p className="mb-6 mt-1 text-foreground/70">{page("intro")}</p>
        {/* Prerendered form; ?callbackUrl / ?error stream in (see sign-in-slot.tsx). */}
        <SignInSlot searchParams={searchParams} />
      </Card>
    </main>
  );
}
