import type { HTMLAttributes } from "react";
import { cn } from "./cn.ts";

/** Bordered panel used for forms and content blocks. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-2xl border border-foreground/15 bg-background p-6 shadow-sm", className)}
      {...rest}
    />
  );
}
