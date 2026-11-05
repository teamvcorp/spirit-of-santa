/**
 * Turns a template name + values into { subject, text, html } in the recipient's language.
 * Pure (no network, no env), so it's unit-tested directly.
 *
 * Security:
 *  - Every value placed into HTML is escaped (a store named `<script>` stays text).
 *  - Links must be absolute https:// URLs on our own app hosts, or http://localhost in dev
 *    (assertSafeLink), so a template can never be turned into a phishing link to elsewhere.
 *  - Plain-text part is always included (better deliverability, accessible, and readable
 *    in clients that block HTML).
 */
// use-intl/core = next-intl's framework-free translator (works in tests, scripts, emails).
import { createTranslator } from "use-intl/core";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@repo/lib/locales";
import en from "../messages/en.json" with { type: "json" };
import es from "../messages/es.json" with { type: "json" };

const MESSAGES: Record<Locale, typeof en> = { en, es };

/** Template name → the values it needs. Add a template here + in messages/*.json. */
export type EmailTemplates = {
  /** No user-typed text: this goes to an address nobody has verified yet (anti-spam-relay). */
  verifyEmail: { link: string };
  accountExists: { link: string };
  resetPassword: { link: string };
};
export type EmailTemplateName = keyof EmailTemplates;

export type RenderedEmail = { subject: string; text: string; html: string };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Our sending hosts. Links in emails must point here (or localhost during development). */
const ALLOWED_LINK_HOSTS = /^(?:[a-z0-9-]+\.)*spiritofsanta\.com$/;

export function assertSafeLink(link: string): string {
  const u = new URL(link); // throws on garbage
  const devLocal = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if (!(u.protocol === "https:" && ALLOWED_LINK_HOSTS.test(u.hostname)) && !devLocal) {
    throw new Error(`Refusing to email a link to ${u.host}`);
  }
  return u.toString();
}

export function renderEmail<T extends EmailTemplateName>(
  template: T,
  values: EmailTemplates[T],
  locale: unknown,
): RenderedEmail {
  const safeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = createTranslator({ locale: safeLocale, messages: MESSAGES[safeLocale], namespace: "Email" });
  // Loosely typed lookups: template keys are checked by the parity test + EmailTemplates.
  const tt = t as unknown as (key: string, v?: Record<string, string>) => string;
  const has = (key: string) => (t as unknown as { has: (k: string) => boolean }).has(key);

  const link = assertSafeLink(values.link);
  const textValues = values as unknown as Record<string, string>;
  const subject = tt(`${template}.subject`);
  const heading = tt(`${template}.heading`);
  const body = tt(`${template}.body`, textValues);
  const button = tt(`${template}.button`);
  const expiry = has(`${template}.expiry`) ? tt(`${template}.expiry`) : "";
  const showIgnore = template !== "accountExists";

  const text = [
    heading,
    "",
    body,
    "",
    `${button}: ${link}`,
    expiry,
    showIgnore ? tt("ignore") : "",
    "",
    "--",
    tt("footer"),
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  // Escape everything, including translated strings (they contain user values like names).
  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="${safeLocale}"><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px 28px;border-top:6px solid #b3261e;border-radius:8px 8px 0 0">
<p style="margin:0 0 4px;font-weight:bold;color:#8c1d18">Spirit O Santa</p>
<h1 style="margin:0 0 16px;font-size:22px">${e(heading)}</h1>
<p style="margin:0 0 20px;line-height:1.5">${e(body)}</p>
<p style="margin:0 0 20px"><a href="${e(link)}" style="display:inline-block;background:#b3261e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${e(button)}</a></p>
${expiry ? `<p style="margin:0 0 12px;color:#555;font-size:14px">${e(expiry)}</p>` : ""}
<p style="margin:0 0 4px;color:#555;font-size:13px">${e(tt("linkFallback"))}</p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all"><a href="${e(link)}" style="color:#8c1d18">${e(link)}</a></p>
${showIgnore ? `<p style="margin:0;color:#555;font-size:13px">${e(tt("ignore"))}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;color:#767676;font-size:12px;border-top:1px solid #eee">${e(tt("footer"))}</td></tr>
</table></body></html>`;

  return { subject, text, html };
}
