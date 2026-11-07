import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { requireRole } from "@repo/auth";
import { Card } from "@repo/ui/card";
import { authOptions } from "@/auth";
import { InviteForm } from "./invite-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("StoreAdmin");
  return { title: t("inviteTitle") };
}

/** Only admins see the form (the Server Action re-checks anyway). */
async function Guarded() {
  await connection();
  await requireRole(authOptions, "admin");
  return <InviteForm />;
}

export default async function InvitePage() {
  const t = await getTranslations("StoreAdmin");
  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-xl">
        <h1 className="text-2xl font-bold">{t("inviteTitle")}</h1>
        <p className="mb-6 mt-1 text-muted">{t("inviteIntro")}</p>
        <Suspense fallback={null}>
          <Guarded />
        </Suspense>
      </Card>
    </main>
  );
}