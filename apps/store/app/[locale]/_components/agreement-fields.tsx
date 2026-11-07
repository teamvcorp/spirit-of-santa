/**
 * Store discount + guarantee agreement: scrollable text + required checkbox (name="agree").
 * Used by /register and /accept-invite. The accepted version (STORE_AGREEMENT_VERSION) is
 * recorded on the store server-side; the text lives in StoreAgreement messages (DRAFT
 * wording until the user approves it).
 * The `_components` folder name keeps Next from treating it as a route.
 */
import { useTranslations } from "next-intl";
import { STORE_AGREEMENT_VERSION } from "@repo/lib/store";

const POINTS = ["p1", "p2", "p3", "p4", "p5"] as const;

export function AgreementFields({ defaultChecked, error }: { defaultChecked?: boolean; error?: string }) {
  const t = useTranslations("StoreAgreement");
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-lg font-semibold">{t("title")}</legend>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-input p-4 text-sm" tabIndex={0} role="region" aria-label={t("title")}>
        <ol className="list-decimal space-y-2 pl-5">
          {POINTS.map((p) => (
            <li key={p}>{t(p)}</li>
          ))}
        </ol>
        <p className="mt-3 text-muted">{t("version", { version: STORE_AGREEMENT_VERSION })}</p>
      </div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="agree"
          required
          defaultChecked={defaultChecked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "agree-error" : undefined}
          className="mt-1 size-5"
        />
        <span>{t("accept")}</span>
      </label>
      {error && (
        <p id="agree-error" className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
