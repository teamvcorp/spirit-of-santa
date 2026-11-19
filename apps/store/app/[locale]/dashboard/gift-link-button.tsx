"use client";
/**
 * "Email me my gift link" (founding partners slice 3): the owner gets a single-use link to give Christmas Magic AS
 * their store. The message stays in this component (role=status / role=alert), so it is announced.
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { sendMyGiftLinkAction } from "./actions";
import { INITIAL_DASH_STATE } from "./form-state";

export function GiftLinkButton() {
  const t = useTranslations("Dashboard.gift");
  const [state, action, pending] = useActionState(sendMyGiftLinkAction, INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.status === "done" && <Alert>{t("sent")}</Alert>}
      {state.status === "error" && <Alert tone="error">{t(state.error === "rateLimited" ? "tooMany" : "failed")}</Alert>}
      <Button type="submit" variant="secondary" pending={pending} disabled={!hydrated} className="self-start" data-testid="gift-link-button">
        {t("button")}
      </Button>
    </form>
  );
}
