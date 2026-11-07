/**
 * Labelled <select> with optional hint and error: the drop-down twin of TextField (same look via
 * FIELD_CONTROL, same accessibility wiring: <label htmlFor>, aria-describedby for hint/error,
 * aria-invalid). Pass the <option>s as children. Phase 8.5.4 review: before this, every app styled
 * its own selects slightly differently. New drop-downs should use this.
 */
import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "./cn.ts";
import { FIELD_CONTROL } from "./text-field.tsx";

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function SelectField({ label, hint, error, id, className, children, ...select }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={selectId} className="text-sm font-semibold">
        {label}
      </label>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_CONTROL, error ? "border-danger" : "border-input")}
        {...select}
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
