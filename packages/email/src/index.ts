/**
 * Transactional email via Resend. SERVER-ONLY (the API key must never reach a browser).
 *
 *   await sendEmail({ to, locale: user.locale, template: "resetPassword", values: { link },
 *                     idempotencyKey: `reset/${tokenId}` });
 *
 * - Sender: RESEND_FROM (default "Spirit O Santa <no-reply@fyht4.com>"; fyht4.com is the
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
import { Resend } from "resend";
import { assertSafeLink, renderEmail, type EmailTemplateName, type EmailTemplates, type OptOutLinks } from "./render.ts";

export { renderEmail, escapeHtml, assertSafeLink, type EmailTemplateName, type EmailTemplates, type OptOutLinks } from "./render.ts";

const DEFAULT_FROM = "Spirit O Santa <no-reply@fyht4.com>";
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
 * `batchKey` makes each chunk idempotent for 24 h (`<batchKey>/<chunk>`): a retried run with the
 * SAME inputs in the SAME order can't send twice. Returns the indexes of inputs that were sent;
 * a failed chunk is reported (not thrown) so the caller can retry just those next time.
 * Note: Resend's batch API doesn't support attachments or scheduling (we use neither).
 */
export async function sendEmailBatch(inputs: SendEmailInput<EmailTemplateName>[], batchKey: string): Promise<{ sent: number[]; failed: number[] }> {
  const sent: number[] = [];
  const failed: number[] = [];
  for (let start = 0; start < inputs.length; start += EMAIL_BATCH_SIZE) {
    const chunk = inputs.slice(start, start + EMAIL_BATCH_SIZE);
    const idx = chunk.map((_, i) => start + i);
    const payloads = chunk.map((input) => payload(input));
    if (payloads.every((p, i) => devPrint(p, chunk[i]!.template))) {
      sent.push(...idx);
      continue;
    }
    try {
      const { error } = await resend().batch.send(payloads, { idempotencyKey: `${batchKey}/${start / EMAIL_BATCH_SIZE}`.slice(0, 256) });
      if (error) throw new Error(`${error.name}: ${error.message}`);
      sent.push(...idx);
    } catch (err) {
      // name only: no addresses or bodies in logs.
      console.error("[email] batch chunk failed:", err instanceof Error ? err.name : "unknown");
      failed.push(...idx);
    }
  }
  return { sent, failed };
}
