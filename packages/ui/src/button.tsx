/**
 * Button. Works in Server and Client Components (no hooks, no "use client").
 * `pending` disables the button and sets aria-busy so screen readers announce the wait
 * and double-submits (e.g. two tip payments) can't happen from repeated clicks.
 * Defaults to type="button" so a button inside a form never submits by accident.
 */
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.ts";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-red text-white hover:bg-brand-red-dark",
  secondary: "border border-current text-foreground hover:bg-foreground/5",
  ghost: "text-foreground underline-offset-4 hover:underline",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  pending?: boolean;
}

export function Button({
  variant = "primary",
  pending = false,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 font-semibold",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
