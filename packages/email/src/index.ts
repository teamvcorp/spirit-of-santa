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
import { renderEmail, type EmailTemplateName, type EmailTemplates } from "./render.ts";

export { renderEmail, escapeHtml, assertSafeLink, type EmailTemplateName, type EmailTemplates } from "./render.ts";

const DEFAULT_FROM = "Spirit O Santa <no-reply@fyht4.com>";
let client: Resend | null = null;

export type SendEmailInput<T extends EmailTemplateName> = {
  to: string;
  locale: unknown;
  template: T;
  values: EmailTemplates[T];
  /** e.g. "verify/<tokenId>". Max 256 chars. Same key within 24 h = not sent twice. */
  idempotencyKey?: string;
};

export async function sendEmail<T extends EmailTemplateName>(input: SendEmailInput<T>): Promise<void> {
  const { subject, text, html } = renderEmail(input.template, input.values, input.locale);
  const key = process.env.RESEND_API_KEY;
  const isProd = process.env.NODE_ENV === "production";

  // Outside production, PRINT instead of sending unless EMAIL_DEV_SEND=true is set on purpose.
  // Local testing then can't email real people (or bounce off fake test addresses and hurt
  // the sending domain's reputation, which happened once on 2026-11-05).
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (!isProd && process.env.EMAIL_DEV_SEND !== "true") {
    console.info(`\n[email:dev] to=${input.to} template=${input.template}\n[email:dev] subject: ${subject}\n${text}\n[email:dev] ---- end\n`);
    return;
  }
  if (!key) throw new Error("RESEND_API_KEY is not set");

  client ??= new Resend(key);
  const { error } = await client.emails.send(
    {
      from: process.env.RESEND_FROM || DEFAULT_FROM,
      to: input.to,
      subject,
      text,
      html,
      // A monitored inbox for replies (set RESEND_REPLY_TO), since no-reply@ isn't read.
      ...(process.env.RESEND_REPLY_TO ? { replyTo: process.env.RESEND_REPLY_TO } : {}),
      tags: [{ name: "template", value: input.template }],
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey.slice(0, 256) } : undefined,
  );
  if (error) {
    // name/message only: no recipient address or body in logs (privacy + one-time links).
    throw new Error(`Resend send failed (${input.template}): ${error.name}: ${error.message}`);
  }
}
