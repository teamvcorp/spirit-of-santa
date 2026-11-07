/**
 * Button. Works in Server and Client Components (no hooks, no "use client").
 * `pending` disables the button and sets aria-busy so screen readers announce the wait
 * and double-submits (e.g. two tip payments) can't happen from repeated clicks.
 * Defaults to type="button" so a button inside a form never submits by accident.
 *
 * Winter Night (Phase 8.5): pill-shaped, primary = night blue by day / gold by night (theme
 * tokens). `buttonClass()` gives a LINK the exact same look ("a link that looks like a button"):
 * the ONE place button styling lives.
 */
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "festive";

const BASE = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2 font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border-2 border-current text-foreground hover:bg-foreground/5",
  ghost: "text-foreground underline-offset-4 hover:underline",
  // Berry red: celebrations and the one big call to action on a page; use sparingly.
  festive: "bg-berry text-white hover:brightness-110",
};

/** Classes for a button-looking element (use on <Link>/<a>). */
export function buttonClass(variant: ButtonVariant = "primary", className?: string): string {
  return cn(BASE, VARIANTS[variant], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  pending?: boolean;
}

export function Button({ variant = "primary", pending = false, disabled, className, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || pending} aria-busy={pending || undefined} className={buttonClass(variant, className)} {...rest}>
      {children}
    </button>
  );
}
