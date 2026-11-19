"use client";
/**
 * Store logo for the PUBLIC partners page (owner 2026-11-18). Only the owner sees this card: uploading is the
 * company's permission for Spirit of Santa to show its logo there. Same file rules as photos (checked + re-encoded on
 * the server by @repo/storage; the size check here is only quick feedback, like photos.tsx).
 */
import Image from "next/image";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { IMAGE_ACCEPT_ATTR, MAX_IMAGE_BYTES } from "@repo/storage/image-rules";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { removeLogoAction, setLogoAction } from "../actions";
import { INITIAL_DASH_STATE, reporting } from "../form-state";

export function StoreLogo({ logoUrl, editable }: { logoUrl?: string; editable: boolean }) {
  const t = useTranslations("Profile");
  const errorsT = useTranslations("Dashboard.errors");
  const hydrated = useHydrated();
  const [notice, setNotice] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [state, upload, uploading] = useActionState(reporting(setLogoAction, () => setNotice(t("logoSaved"))), INITIAL_DASH_STATE);
  const [removeState, remove, removing] = useActionState(reporting(removeLogoAction, () => setNotice(t("logoRemoved"))), INITIAL_DASH_STATE);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  function checkSize(e: FormEvent<HTMLFormElement>) {
    const file = (e.currentTarget.elements.namedItem("logo") as HTMLInputElement | null)?.files?.[0];
    setNotice(null);
    if (file && file.size > MAX_IMAGE_BYTES) {
      e.preventDefault();
      setClientError(errorsT("too_large"));
    } else setClientError(null);
  }
  const error =
    clientError ??
    (state.status === "error" && state.error ? errorsT(state.error as never) : removeState.status === "error" && removeState.error ? errorsT(removeState.error as never) : null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("logoIntro")}</p>
      <div ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {notice && <Alert>{notice}</Alert>}
      </div>
      {logoUrl ? (
        <div className="flex items-center gap-4">
          {/* Logos are shown whole (contain), on a light tile, like on the partners page. */}
          <div className="flex size-32 items-center justify-center rounded-xl bg-snow p-2">
            <Image src={logoUrl} alt={t("logoAlt")} width={128} height={128} className="max-h-full w-auto object-contain" data-testid="store-logo" />
          </div>
          {editable && (
            <form action={remove}>
              <Button type="submit" variant="ghost" size="sm" pending={removing} disabled={!hydrated}>
                {t("removeLogo")}
              </Button>
            </form>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("noLogo")}</p>
      )}
      {editable && (
        <form key={state.nonce ?? "initial"} action={upload} onSubmit={checkSize} className="flex flex-col gap-2">
          <label htmlFor="logo" className="text-sm font-medium">
            {logoUrl ? t("replaceLogo") : t("addLogo")}
          </label>
          <input
            id="logo"
            name="logo"
            type="file"
            accept={IMAGE_ACCEPT_ATTR}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "logo-hint logo-error" : "logo-hint"}
            className="text-sm"
          />
          <p id="logo-hint" className="text-sm text-muted">
            {t("photoHint", { mb: MAX_IMAGE_BYTES / 1024 / 1024 })}
          </p>
          {error && (
            <p id="logo-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" pending={uploading} disabled={!hydrated} className="self-start">
            {t("uploadLogo")}
          </Button>
        </form>
      )}
    </div>
  );
}
