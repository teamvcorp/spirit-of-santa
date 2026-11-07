/**
 * Labelled input with optional hint and error. Accessibility built in:
 *  - <label htmlFor> is always rendered (placeholders are not labels).
 *  - The error and hint are linked with aria-describedby, and aria-invalid marks the field,
 *    so screen readers read the message when the field is focused.
 */
import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./cn.ts";

/**
 * The ONE look for form controls (TextField and SelectField share it). w-full + min-w-0 let a control
 * shrink to its column (an <input> otherwise insists on ~20 characters and overflows narrow grid
 * cells: see @repo/ui/layout).
 */
export const FIELD_CONTROL = "min-h-11 w-full min-w-0 rounded-xl border bg-surface px-3 py-2 text-foreground";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, id, className, ...input }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={inputId} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_CONTROL, error ? "border-danger" : "border-input")}
        {...input}
      />
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
