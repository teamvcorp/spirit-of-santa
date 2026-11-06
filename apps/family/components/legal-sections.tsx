/**
 * Titled sections of a legal page (/privacy, /terms, /text-messages), read from messages
 * `<namespace>.sections.<key>.{title,body}`. One shared component so the pages stay consistent
 * (anchors on the <section>, line breaks kept). `values` = ICU values shared by every body.
 * Keys are checked by the i18n parity test; next-intl can't type a runtime key, hence the cast.
 */
import { getTranslations } from "next-intl/server";

type LegalNamespace = "Privacy" | "Terms" | "TextMessages";

export async function LegalSections({ namespace, keys, values }: { namespace: LegalNamespace; keys: readonly string[]; values?: Record<string, string | number> }) {
  const t = (await getTranslations(namespace)) as unknown as (key: string, v?: Record<string, string | number>) => string;
  return (
    <>
      {keys.map((k) => (
        <section key={k} id={k} className="mb-6 scroll-mt-6">
          <h2 className="mb-2 text-lg font-semibold">{t(`sections.${k}.title`)}</h2>
          <p className="whitespace-pre-line">{t(`sections.${k}.body`, values)}</p>
        </section>
      ))}
    </>
  );
}
