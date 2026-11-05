/**
 * Labelled input with optional hint and error. Accessibility built in:
 *  - <label htmlFor> is always rendered (placeholders are not labels).
 *  - The error and hint are linked with aria-describedby, and aria-invalid marks the field,
 *    so screen readers read the message when the field is focused.
 */
import { useId, type InputHTMLAttributes } from "react";
import { cn } from "./cn.ts";

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
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-11 rounded-lg border bg-background px-3 py-2 text-foreground",
          error ? "border-danger" : "border-input",
        )}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-sm text-foreground/70">
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
