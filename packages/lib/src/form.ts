/**
 * FormData helpers. CLIENT-SAFE. Use in Server Actions instead of re-declaring them.
 */

/** A text field's value, or "" (files and missing fields become ""). */
export function formString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
