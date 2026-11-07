"use client";
/**
 * Thank-you notes waiting for the parent (owner 2026-11-07). Someone who scanned a child's QR code without money
 * left a READY-MADE note; the parent approves it (the child then sees it on their page) or hides it. Each note also
 * offers "Add Christmas Magic for this deed" (the bonus page with this child chosen) in case the parent wants to
 * contribute. The Server Action re-checks the PIN unlock and the family (thankNoteAction).
 */
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@repo/ui/button";
import { useHydrated } from "@repo/ui/use-hydrated";
import { Link } from "@/i18n/navigation";
import { thankNoteAction, type ParentFormState } from "./actions";

type Note = { deedId: string; kidId: string; kidName: string; deed: string; note: string };

function NoteRow({ n }: { n: Note }) {
  const t = useTranslations("Parent");
  const notes = useTranslations("Qr.notes");
  const [state, action, pending] = useActionState(thankNoteAction, { status: "idle" } as ParentFormState);
  const hydrated = useHydrated();
  return (
    <li className="flex flex-col gap-2 py-3" data-deed={n.deedId}>
      <p className="text-sm text-muted">{t("noteFor", { name: n.kidName, deed: n.deed })}</p>
      <p className="font-semibold">“{notes(n.note as never)}”</p>
      <div className="flex flex-wrap items-center gap-2">
        {(["approved", "hidden"] as const).map((d) => (
          <form key={d} action={action}>
            <input type="hidden" name="deedId" value={n.deedId} />
            <input type="hidden" name="decision" value={d} />
            <Button type="submit" size="sm" variant={d === "approved" ? "primary" : "secondary"} pending={pending} disabled={!hydrated}>
              {d === "approved" ? t("noteApprove") : t("noteHide")}
            </Button>
          </form>
        ))}
        <Link href={`/parent/bonus?kid=${n.kidId}`} className="text-sm font-semibold underline underline-offset-4">
          {t("noteAddMagic")}
        </Link>
      </div>
      {state.status === "error" && state.error && <span role="alert" className="text-sm text-danger">{t(`errors.${state.error}` as never)}</span>}
    </li>
  );
}

export function ThankNotes({ notes }: { notes: Note[] }) {
  return (
    <ul className="flex flex-col divide-y divide-foreground/10" data-testid="thank-notes">
      {notes.map((n) => (
        <NoteRow key={n.deedId} n={n} />
      ))}
    </ul>
  );
}
