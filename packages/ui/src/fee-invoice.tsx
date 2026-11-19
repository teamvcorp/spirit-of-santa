/**
 * Founding partner fee invoice (2026-11-18): ONE layout for the admin's printable copy and the store's own copy, so
 * the two can never disagree. Presentational only: every string arrives already translated and formatted.
 * It is a BUSINESS invoice: never put donation / tax-receipt wording in here (owner rule).
 */
import { cn } from "./cn";

export type FeeInvoiceProps = {
  title: string;
  /** label → value rows, in order (invoice no., date, billed to, payable to, amount, status...). */
  rows: { label: string; value: string }[];
  /** Plain sentences under the table (business payment, not a donation, non-refundable, how to pay). */
  notes: string[];
  className?: string;
};

export function FeeInvoice({ title, rows, notes, className }: FeeInvoiceProps) {
  return (
    <section className={cn("flex flex-col gap-4", className)} data-testid="fee-invoice">
      <h1 className="text-2xl font-bold">{title}</h1>
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted">{r.label}</dt>
            <dd className="font-medium break-words whitespace-pre-line">{r.value}</dd>
          </div>
        ))}
      </dl>
      {notes.map((n) => (
        <p key={n} className="text-sm">
          {n}
        </p>
      ))}
    </section>
  );
}
