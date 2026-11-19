"use client";
/**
 * Store Christmas Magic gifts on the admin store page (founding partners slice 3): this season's counted total, the
 * North Star status, and "Send gift link" (emails the store's CONFIRMED owner a single-use /donate?store= link).
 * Same feedback pattern as StoreActions: the notice lives here and takes focus.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@repo/ui/alert";
import { NorthStar } from "@repo/ui/partner-icons";
import { sendGiftLinkAction } from "../actions";
import { ActionForm } from "./store-actions";

export function StoreGiftCard({ storeId, total, donor, threshold }: { storeId: string; total: string; donor: boolean; threshold: string | null }) {
  const t = useTranslations("StoreAdmin.gifts");
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  return (
    <div className="flex flex-col gap-3" data-testid="store-gifts">
      <p className="text-sm text-muted">{t("intro")}</p>
      <div ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {notice && <Alert>{notice}</Alert>}
      </div>
      <p className="font-semibold" data-testid="store-gift-total">
        {t("total", { amount: total })}
      </p>
      <p className="flex items-center gap-1 text-sm">
        {donor && <NorthStar className="size-4" />}
        {threshold === null ? t("noBadge") : donor ? t("donorYes", { threshold }) : t("donorNo", { threshold })}
      </p>
      <ActionForm action={sendGiftLinkAction} storeId={storeId} title={t("sendTitle")} submit={t("send")} doneMessage={t("sent")} onDone={(m) => setNotice(m)} variant="secondary" />
    </div>
  );
}
