"use client";
/**
 * Store photos: upload (JPEG/PNG/WebP, ≤ 4 MB, up to 10) and remove. Files are checked and
 * re-encoded on the server (@repo/storage); the checks here are for quick, friendly feedback.
 *
 * - Size is checked in the browser BEFORE sending: a file over the Server Action body limit
 *   would otherwise be rejected by the platform with a generic error (review finding).
 * - Success messages live in the parent (they survive the re-render after refresh()) in a
 *   role=status region that receives focus; errors are shown next to what failed.
 */
import Image from "next/image";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { IMAGE_ACCEPT_ATTR, MAX_IMAGE_BYTES } from "@repo/storage/image-rules";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { addPhotoAction, removePhotoAction } from "../actions";
import { INITIAL_DASH_STATE, type DashFormState } from "../form-state";

export type PhotoRow = { url: string; pathname: string };
type Action = (prev: DashFormState, fd: FormData) => Promise<DashFormState>;

/** Wrap an action so success is reported from inside the call (the form may unmount after refresh). */
function reporting(action: Action, onDone: () => void): Action {
  return async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.status === "done") onDone();
    return result;
  };
}

function RemovePhoto({ pathname, label, onDone }: { pathname: string; label: string; onDone: () => void }) {
  const errorsT = useTranslations("Dashboard.errors");
  const [state, formAction, pending] = useActionState(reporting(removePhotoAction, onDone), INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="pathname" value={pathname} />
      <Button type="submit" variant="ghost" pending={pending} disabled={!hydrated} size="sm" className="self-start">
        {label}
      </Button>
      {state.status === "error" && state.error && (
        <p role="alert" className="text-sm text-danger">
          {errorsT(state.error as never)}
        </p>
      )}
    </form>
  );
}

export function Photos({ photos, editable, max }: { photos: PhotoRow[]; editable: boolean; max: number }) {
  const t = useTranslations("Profile");
  const errorsT = useTranslations("Dashboard.errors");
  const [notice, setNotice] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [state, formAction, pending] = useActionState(
    reporting(addPhotoAction, () => setNotice(t("photoAdded"))),
    INITIAL_DASH_STATE,
  );
  const hydrated = useHydrated();
  const full = photos.length >= max;
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  function checkSize(e: FormEvent<HTMLFormElement>) {
    const file = (e.currentTarget.elements.namedItem("photo") as HTMLInputElement | null)?.files?.[0];
    setNotice(null);
    if (file && file.size > MAX_IMAGE_BYTES) {
      e.preventDefault(); // don't send a file the server would refuse anyway
      setClientError(errorsT("too_large"));
    } else {
      setClientError(null);
    }
  }

  const uploadError = clientError ?? (state.status === "error" && state.error ? errorsT(state.error as never) : null);
  return (
    <div className="flex flex-col gap-4">
      <div ref={noticeRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {notice && <Alert>{notice}</Alert>}
      </div>
      {photos.length === 0 ? (
        <p className="text-sm text-foreground/70">{t("noPhotos")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.pathname} className="flex flex-col gap-1">
              <Image src={p.url} alt={t("photoAlt", { n: i + 1 })} width={320} height={240} className="aspect-[4/3] w-full rounded-lg object-cover" />
              {editable && <RemovePhoto pathname={p.pathname} label={t("removePhoto")} onDone={() => setNotice(t("photoRemoved"))} />}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form key={state.nonce ?? "initial"} action={formAction} onSubmit={checkSize} className="flex flex-col gap-2">
          <label htmlFor="photo" className="text-sm font-medium">
            {t("addPhoto", { count: photos.length, max })}
          </label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept={IMAGE_ACCEPT_ATTR}
            required
            disabled={full}
            aria-invalid={uploadError ? true : undefined}
            aria-describedby={uploadError ? "photo-hint photo-error" : "photo-hint"}
            className="text-sm"
          />
          <p id="photo-hint" className="text-sm text-foreground/70">
            {t("photoHint", { mb: MAX_IMAGE_BYTES / 1024 / 1024 })}
          </p>
          {uploadError && (
            <p id="photo-error" role="alert" className="text-sm text-danger">
              {uploadError}
            </p>
          )}
          <Button type="submit" pending={pending} disabled={!hydrated || full} className="self-start">
            {t("upload")}
          </Button>
        </form>
      )}
    </div>
  );
}
