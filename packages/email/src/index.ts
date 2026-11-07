/**
 * Transactional email via Resend. SERVER-ONLY (the API key must never reach a browser).
 *
 *   await sendEmail({ to, locale: user.locale, template: "resetPassword", values: { link },
 *                     idempotencyKey: `reset/${tokenId}` });
 *
 * - Sender: RESEND_FROM (default "Spirit of Santa <no-reply@fyht4.com>"; fyht4.com is the
 *   verified sending domain, user decision 2026-11-05).
 * - Development without RESEND_API_KEY: the email is printed to the server console instead
 *   of sent (so flows can be tested locally). Production without a key THROWS: we never
 *   silently drop real users' emails.
 * - Resend returns { data, error } instead of throwing; we convert error → throw so callers
 *   can't forget to check. Never log the full email body (it contains one-time links).
 * - idempotencyKey (24 h window at Resend) makes a retried request send only once.
 * Notes: docs/vendor/resend.md
 */
import "server-only";
import { createHash } from "node:crypto";
import { Resend } from "resend";
import { assertSafeLink, renderEmail, type EmailTemplateName, type EmailTemplates, type OptOutLinks } from "./render.ts";

export { renderEmail, escapeHtml, assertSafeLink, digestLines, type EmailTemplateName, type EmailTemplates, type OptOutLinks } from "./render.ts";

const DEFAULT_FROM = "Spirit of Santa <no-reply@fyht4.com>";
let client: Resend | null = null;

export type SendEmailInput<T extends EmailTemplateName> = {
  to: string;
  locale: unknown;
  template: T;
  values: EmailTemplates[T];
  /** e.g. "verify/<tokenId>". Max 256 chars. Same key within 24 h = not sent twice. */
  idempotencyKey?: string;
  /**
   * Notification emails only: footer links + the List-Unsubscribe headers mail providers use for
   * their own "unsubscribe" button (RFC 8058 one-click: `optOut` must accept a POST).
   */
  optOutLinks?: OptOutLinks;
};

/** Everything Resend needs for one email (shared by single + batch sends). */
function payload<T extends EmailTemplateName>(input: SendEmailInput<T>) {
  const { subject, text, html } = renderEmail(input.template, input.values, input.locale, input.optOutLinks);
  return {
    from: process.env.RESEND_FROM || DEFAULT_FROM,
    to: input.to,
    subject,
    text,
    html,
    // A monitored inbox for replies (set RESEND_REPLY_TO), since no-reply@ isn't read.
    ...(process.env.RESEND_REPLY_TO ? { replyTo: process.env.RESEND_REPLY_TO } : {}),
    tags: [{ name: "template", value: input.template }],
    ...(input.optOutLinks
      ? { headers: { "List-Unsubscribe": `<${assertSafeLink(input.optOutLinks.oneClick)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
      : {}),
  };
}

/** Outside production, PRINT instead of sending unless EMAIL_DEV_SEND=true is set on purpose. */
function devPrint(p: ReturnType<typeof payload>, template: string): boolean {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (process.env.NODE_ENV === "production" || process.env.EMAIL_DEV_SEND === "true") return false;
  console.info(`\n[email:dev] to=${p.to} template=${template}\n[email:dev] subject: ${p.subject}\n${p.text}\n[email:dev] ---- end\n`);
  return true;
}

function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  client ??= new Resend(key);
  return client;
}

export async function sendEmail<T extends EmailTemplateName>(input: SendEmailInput<T>): Promise<void> {
  const p = payload(input);
  // Local testing prints instead of sending, so it can't email real people (or bounce off fake test
  // addresses and hurt the sending domain's reputation, which happened once on 2026-11-05).
  if (devPrint(p, input.template)) return;
  const { error } = await resend().emails.send(p, input.idempotencyKey ? { idempotencyKey: input.idempotencyKey.slice(0, 256) } : undefined);
  if (error) {
    // name/message only: no recipient address or body in logs (privacy + one-time links).
    throw new Error(`Resend send failed (${input.template}): ${error.name}: ${error.message}`);
  }
}

/** Resend's batch endpoint takes at most 100 emails per request (docs/vendor/resend.md). */
export const EMAIL_BATCH_SIZE = 100;

/**
 * Send many emails (Phase 7 daily digests): up to 100 per request instead of one request each,
 * so a few thousand families fit easily in the daily job and in Resend's 10 requests/s limit.
 *  - Each chunk's idempotency key is `<batchKey>/<hash of exactly what it sends>`: re-sending the
 *    SAME emails within 24 h is a no-op, and retrying a DIFFERENT set (e.g. only the failed ones)
 *    can never collide with an earlier chunk's key.
 *  - An email that can't even be built (bad link, missing value) fails ALONE; the rest still go.
 *  - A missing RESEND_API_KEY when really sending is a configuration error: it THROWS (loud),
 *    like sendEmail, instead of looking like ordinary failures.
 * Returns the input indexes sent and failed. Resend's batch API has no attachments/scheduling.
 */
export async function sendEmailBatch(inputs: SendEmailInput<EmailTemplateName>[], batchKey: string): Promise<{ sent: number[]; failed: number[] }> {
  const sent: number[] = [];
  const failed: number[] = [];
  const built: { i: number; p: ReturnType<typeof payload> }[] = [];
  inputs.forEach((input, i) => {
    try {
      built.push({ i, p: payload(input) });
    } catch (err) {
      failed.push(i);
      console.error("[email] batch email could not be built:", err instanceof Error ? err.name : "unknown");
    }
  });
  const toSend = built.filter(({ i, p }) => {
    if (!devPrint(p, inputs[i]!.template)) return true;
    sent.push(i);
    return false;
  });
  if (toSend.length === 0) return { sent, failed };
  const api = resend(); // throws if RESEND_API_KEY is missing: never a silent "all failed"
  for (let start = 0; start < toSend.length; start += EMAIL_BATCH_SIZE) {
    const chunk = toSend.slice(start, start + EMAIL_BATCH_SIZE);
    const digest = createHash("sha256");
    for (const { p } of chunk) digest.update(`${p.to}\u0000${p.subject}\u0000${p.text}\u0001`);
    try {
      const { error } = await api.batch.send(chunk.map((c) => c.p), { idempotencyKey: `${batchKey}/${digest.digest("base64url").slice(0, 32)}`.slice(0, 256) });
      if (error) throw new Error(`${error.name}: ${error.message}`);
      sent.push(...chunk.map((c) => c.i));
    } catch (err) {
      // name only: no addresses or bodies in logs.
      console.error("[email] batch chunk failed:", err instanceof Error ? err.name : "unknown");
      failed.push(...chunk.map((c) => c.i));
    }
  }
  return { sent, failed };
}
