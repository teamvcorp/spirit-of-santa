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
/**
 * Size owns height + padding + text size. `className` / `extra` is for LAYOUT only (margins,
 * self-start, width): never padding, radius or colours, which would clash with these classes
 * (cn() does not de-duplicate Tailwind classes; review 2026-11-06).
 */
export type ButtonSize = "sm" | "md" | "lg" | "inline";

const BASE = "inline-flex items-center justify-center gap-2 rounded-full font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-1 text-sm",
  md: "min-h-11 px-5 py-2",
  lg: "min-h-12 px-6 py-3",
  inline: "min-h-11 px-0", // a ghost button that reads like a link inside text
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border-2 border-current text-foreground hover:bg-foreground/5",
  ghost: "text-foreground underline-offset-4 hover:underline",
  // Berry red: celebrations and the one big call to action on a page; use sparingly.
  festive: "bg-berry text-white hover:brightness-110",
};

/** Classes for a button-looking element (use on <Link>/<a>). `extra` = layout classes only. */
export function buttonClass(variant: ButtonVariant = "primary", extra?: string, size: ButtonSize = "md"): string {
  return cn(BASE, SIZES[size], VARIANTS[variant], extra);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
}

export function Button({ variant = "primary", size = "md", pending = false, disabled, className, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || pending} aria-busy={pending || undefined} className={buttonClass(variant, className, size)} {...rest}>
      {children}
    </button>
  );
}
