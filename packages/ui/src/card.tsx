import type { HTMLAttributes } from "react";
import { cn } from "./cn.ts";

/** Panel for forms and content blocks (Winter Night: soft surface, rounder corners, gentle shadow). */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-3xl border border-foreground/10 bg-surface p-6 shadow-[0_8px_24px_rgba(27,42,74,0.07)]", className)}
      {...rest}
    />
  );
}
