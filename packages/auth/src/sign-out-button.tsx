"use client";
/**
 * Sign-out. next-auth's signOut() POSTs with a CSRF token (a plain GET link could be
 * triggered by another site), clears the session cookie, then loads `callbackUrl`.
 */
import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@repo/ui/button";

export function SignOutButton({ label, callbackUrl = "/" }: { label: string; callbackUrl?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      pending={pending}
      onClick={() => {
        setPending(true);
        void signOut({ callbackUrl });
      }}
    >
      {label}
    </Button>
  );
}
