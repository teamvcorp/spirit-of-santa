/** Pure helper (unit-tested): store name to a URL-safe handle, e.g. "Storm Lake Toys!" -> "storm-lake-toys". */
export function slugify(name: string): string {
  const s = name
    .normalize("NFKD") // split accented letters into letter + accent mark
    .replace(/\p{M}/gu, "") // drop the marks: "Juguetería" -> "jugueteria"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  // Store.slug needs 3-60 chars of [a-z0-9-]; very short/empty names get a "store-" prefix.
  return s.length >= 3 ? s : `store-${s || "x"}`.replace(/-+$/, "");
}
