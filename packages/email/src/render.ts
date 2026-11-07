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
  /** Parent sign-up confirmation (family app). Also no user-typed text. */
  verifyParentEmail: { link: string };
  accountExists: { link: string };
  resetPassword: { link: string };
  /** storeName typed by an admin. */
  inviteOwner: { storeName: string; link: string };
  /** Sent to the VERIFIED owner of the store, about their own store. */
  storeApproved: { storeName: string; link: string };
  storeRejected: { storeName: string; reason: string; link: string };
  /** Only APPROVED (admin-reviewed) stores can send this; storeName is in the body, not the subject. */
  inviteRep: { storeName: string; link: string };
  /** Security alert to an admin: two-step sign-in was just turned on (catches a hijacked enrolment). */
  mfaEnabled: { link: string };
  /**
   * Tax receipt for a community donation (Phase 5 slice 2). donorName = what the donor typed in
   * Stripe Checkout; org details typed by an admin. Body is multi-line (rendered with line breaks).
   */
  donationReceipt: { link: string; receiptNo: string; amount: string; date: string; donorName: string; orgName: string; ein: string; orgAddress: string };
  /**
   * Daily store digest (Phase 6 slice 3): gifts to SET ASIDE and gifts READY TO SHIP. Lists are
   * pre-built lines "2 × Bike (refs AB12CD, EF34GH)"; item names were typed by the store itself,
   * the address by an admin. Nothing about the children, ever.
   */
  storeOrders: { link: string; storeName: string; setAside: string; readyToShip: string; address: string };
  /**
   * To the PARENT when Spirit O Santa sends a gift on to the family (Phase 6 slice 3b). kidName =
   * the child's first name as the parent typed it; itemName typed by the store. Link = the kid's page.
   */
  giftOnItsWay: { link: string; kidName: string; itemName: string };
};

/** Security alerts and "you already have an account": "ignore this email" would be wrong advice. */
const NO_IGNORE_LINE: ReadonlySet<EmailTemplateName> = new Set(["accountExists", "mfaEnabled", "donationReceipt", "storeOrders", "giftOnItsWay"]);
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

/**
 * Notification emails (Phase 7) carry two extra footer links: stop THIS kind of email (one click,
 * signed link, no sign-in) and choose which emails you get (parent area). Both must be our links.
 */
export type OptOutLinks = {
  /** Footer link: a confirmation PAGE (a link scanner opening it unsubscribes nobody). */
  optOut: string;
  /** List-Unsubscribe header: endpoint that unsubscribes on POST (RFC 8058 one-click). */
  oneClick: string;
  /** "Choose which emails you get" (parent area, sign-in + PIN). */
  manage: string;
};

export function renderEmail<T extends EmailTemplateName>(
  template: T,
  values: EmailTemplates[T],
  locale: unknown,
  optOutLinks?: OptOutLinks,
): RenderedEmail {
  const safeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = createTranslator({ locale: safeLocale, messages: MESSAGES[safeLocale], namespace: "Email" });
  // Loosely typed lookups: template keys are checked by the parity test + EmailTemplates.
  const tt = t as unknown as (key: string, v?: Record<string, string>) => string;
  const has = (key: string) => (t as unknown as { has: (k: string) => boolean }).has(key);

  const link = assertSafeLink(values.link);
  const textValues = values as unknown as Record<string, string>;
  // Subjects are a header: never let a value smuggle line breaks into it.
  const subject = tt(`${template}.subject`, textValues).replace(/[\r\n\t]+/g, " ").slice(0, 200);
  const heading = tt(`${template}.heading`);
  const body = tt(`${template}.body`, textValues);
  const button = tt(`${template}.button`);
  const expiry = has(`${template}.expiry`) ? tt(`${template}.expiry`) : "";
  const showIgnore = !NO_IGNORE_LINE.has(template);
  const optOut = optOutLinks ? { stop: assertSafeLink(optOutLinks.optOut), manage: assertSafeLink(optOutLinks.manage) } : null;

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
    ...(optOut ? [`${tt("optOut")}: ${optOut.stop}`, `${tt("manage")}: ${optOut.manage}`] : []),
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
<p style="margin:0 0 20px;line-height:1.5;white-space:pre-line">${e(body)}</p>
<p style="margin:0 0 20px"><a href="${e(link)}" style="display:inline-block;background:#b3261e;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${e(button)}</a></p>
${expiry ? `<p style="margin:0 0 12px;color:#555;font-size:14px">${e(expiry)}</p>` : ""}
<p style="margin:0 0 4px;color:#555;font-size:13px">${e(tt("linkFallback"))}</p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all"><a href="${e(link)}" style="color:#8c1d18">${e(link)}</a></p>
${showIgnore ? `<p style="margin:0;color:#555;font-size:13px">${e(tt("ignore"))}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;color:#767676;font-size:12px;border-top:1px solid #eee">${e(tt("footer"))}${
    optOut ? `<br><a href="${e(optOut.stop)}" style="color:#767676">${e(tt("optOut"))}</a> · <a href="${e(optOut.manage)}" style="color:#767676">${e(tt("manage"))}</a>` : ""
  }</td></tr>
</table></body></html>`;

  return { subject, text, html };
}
