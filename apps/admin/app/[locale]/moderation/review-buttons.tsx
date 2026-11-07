"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { reviewAction, type ReviewState } from "./actions";

export function ReviewButtons({ id, kind = "deed" }: { id: string; kind?: "deed" | "alias" }) {
  const t = useTranslations("Moderation");
  const [state, action, pending] = useActionState(reviewAction, { status: "idle" } as ReviewState);
  const hydrated = useHydrated();
  const button = (decision: "approved" | "rejected", label: string, variant: "primary" | "secondary") => (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" variant={variant} pending={pending} disabled={!hydrated} size="sm">
        {label}
      </Button>
    </form>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {button("approved", t("approve"), "primary")}
      {button("rejected", t("hide"), "secondary")}
      {state.status === "error" && <span role="alert" className="text-sm text-danger">{t(state.error === "failed" ? "errors.failed" : "errors.notFound")}</span>}
    </div>
  );
}
