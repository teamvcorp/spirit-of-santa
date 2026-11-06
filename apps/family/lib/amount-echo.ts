/**
 * Echo of a submitted tip/donation amount, sent back by the server action with every result.
 *
 * Why: after a form action finishes, React 19 RESETS the form (radios go back to their default,
 * text boxes empty). If the picker kept its own "which radio" state, the screen and that state
 * would drift apart (e.g. an empty, required "Other" box silently blocking the next submit).
 * Instead the form is keyed by `nonce` and remounts with these values as its DEFAULTS, so a reset
 * restores exactly what the visitor typed. Plain module (not "use client") so actions can import it.
 */
import { randomUUID } from "node:crypto";

export type AmountEcho = { values?: { amount: string; other: string }; nonce?: string };

const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.slice(0, 10) : ""; // same 10-char cap as the Zod schema
};

export function echoAmount(fd: FormData): Required<AmountEcho> {
  return { values: { amount: field(fd, "amount"), other: field(fd, "other") }, nonce: randomUUID() };
}
