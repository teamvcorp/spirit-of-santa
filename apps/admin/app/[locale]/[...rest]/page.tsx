import { notFound } from "next/navigation";

/**
 * Catch-all for unknown URLs. Without it, an unmatched path never reaches the [locale]
 * layout and Next shows its bare, untranslated 404. This routes it to ../not-found.tsx.
 */
export default function CatchAll() {
  notFound();
}
