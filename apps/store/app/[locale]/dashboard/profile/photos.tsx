"use client";
/**
 * Store photos: upload (JPEG/PNG/WebP, ≤ 4 MB, up to 10) and remove. Files are checked and
 * re-encoded on the server (@repo/storage); `accept` here is only a hint for the picker.
 */
import Image from "next/image";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { IMAGE_ACCEPT_ATTR, MAX_IMAGE_BYTES } from "@repo/storage/image-rules";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { addPhotoAction, removePhotoAction } from "../actions";
import { INITIAL_DASH_STATE } from "../form-state";

export type PhotoRow = { url: string; pathname: string };

function RemovePhoto({ pathname, label }: { pathname: string; label: string }) {
  const [, formAction, pending] = useActionState(removePhotoAction, INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  return (
    <form action={formAction}>
      <input type="hidden" name="pathname" value={pathname} />
      <Button type="submit" variant="ghost" pending={pending} disabled={!hydrated} className="min-h-9 px-2 text-sm">
        {label}
      </Button>
    </form>
  );
}

export function Photos({ photos, editable, max }: { photos: PhotoRow[]; editable: boolean; max: number }) {
  const t = useTranslations("Profile");
  const errorsT = useTranslations("Dashboard.errors");
  const [state, formAction, pending] = useActionState(addPhotoAction, INITIAL_DASH_STATE);
  const hydrated = useHydrated();
  const full = photos.length >= max;
  return (
    <div className="flex flex-col gap-4">
      {photos.length === 0 ? (
        <p className="text-sm text-foreground/70">{t("noPhotos")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.pathname} className="flex flex-col gap-1">
              <Image src={p.url} alt={t("photoAlt", { n: i + 1 })} width={320} height={240} className="aspect-[4/3] w-full rounded-lg object-cover" />
              {editable && <RemovePhoto pathname={p.pathname} label={t("removePhoto")} />}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form key={state.nonce ?? "initial"} action={formAction} className="flex flex-col gap-2">
          {state.status === "error" && state.error && <Alert tone="error">{errorsT(state.error as never)}</Alert>}
          <label htmlFor="photo" className="text-sm font-medium">
            {t("addPhoto", { count: photos.length, max })}
          </label>
          <input id="photo" name="photo" type="file" accept={IMAGE_ACCEPT_ATTR} required disabled={full} aria-describedby="photo-hint" className="text-sm" />
          <p id="photo-hint" className="text-sm text-foreground/70">
            {t("photoHint", { mb: MAX_IMAGE_BYTES / 1024 / 1024 })}
          </p>
          <Button type="submit" pending={pending} disabled={!hydrated || full} className="self-start">
            {t("upload")}
          </Button>
        </form>
      )}
    </div>
  );
}