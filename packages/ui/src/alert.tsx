/**
 * Message box. tone="error" uses role="alert" (announced immediately by screen readers);
 * tone="info" uses role="status" (announced politely, without interrupting).
 */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "error";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-danger/50 bg-danger/10 text-foreground"
          : "border-accent/60 bg-accent/10 text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
