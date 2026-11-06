"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { reviewAction, type ReviewState } from "./actions";

export function ReviewButtons({ id }: { id: string }) {
  const t = useTranslations("Moderation");
  const [state, action, pending] = useActionState(reviewAction, { status: "idle" } as ReviewState);
  const hydrated = useHydrated();
  const button = (decision: "approved" | "rejected", label: string, variant: "primary" | "secondary") => (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <Button type="submit" variant={variant} pending={pending} disabled={!hydrated} className="min-h-9 px-3 py-1 text-sm">
        {label}
      </Button>
    </form>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {button("approved", t("approve"), "primary")}
      {button("rejected", t("hide"), "secondary")}
      {state.status === "error" && <span role="alert" className="text-sm text-danger">{t("errors.notFound")}</span>}
    </div>
  );
}
