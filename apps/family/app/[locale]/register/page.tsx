import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Card } from "@repo/ui/card";
import { Link } from "@/i18n/navigation";
import { registerParentAction } from "../account-actions";
import { ParentRegisterForm } from "./register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("RegisterPage");
  return { title: t("title"), description: t("intro") };
}

export default async function RegisterPage() {
  const t = await getTranslations("RegisterPage");
  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-lg">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mb-6 mt-1 text-foreground/70">{t("intro")}</p>
        <ParentRegisterForm action={registerParentAction} />
        <p className="mt-6 text-sm">
          {t("haveAccount")}{" "}
          <Link href="/signin" className="font-semibold underline underline-offset-4">
            {t("signIn")}
          </Link>
        </p>
      </Card>
    </main>
  );
}
