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
import { DEFAULT_LOCALE, intlLocale, isLocale, type Locale } from "@repo/lib/locales";
import { formatPoints } from "@repo/lib/format";
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
   * To the PARENT when Spirit of Santa sends a gift on to the family (Phase 6 slice 3b). kidName =
   * the child's first name as the parent typed it; itemName typed by the store. Link = the kid's page.
   */
  giftOnItsWay: { link: string; kidName: string; itemName: string };
  /**
   * Phase 7 daily summary to a PARENT: one line per child, built by digestLines() (child names typed
   * by the parent; escaped like every value).
   */
  familyDigest: { link: string; lines: string };
  /** Phase 7 season reminders (date already formatted in the parent's language). */
  cutoffReminder: { link: string; date: string };
  payUpReminder: { link: string; date: string };
};

/** Security alerts and "you already have an account": "ignore this email" would be wrong advice. */
const NO_IGNORE_LINE: ReadonlySet<EmailTemplateName> = new Set(["accountExists", "mfaEnabled", "donationReceipt", "storeOrders", "giftOnItsWay", "familyDigest", "cutoffReminder", "payUpReminder"]);

/**
 * Winter Night look for emails (Phase 8.5.4). Same values as the site palette in
 * packages/ui/src/theme.css (light mode), copied as literals because email clients ignore CSS variables
 * and <style> blocks are often stripped, so everything is an inline style.
 * Contrast (WCAG AA needs 4.5:1 for text): text on card 14.2:1, muted on card 7.6:1,
 * button text (night) on gold 6.5:1, gold-light on the night band 8.7:1.
 * Emails stay light-only (color-scheme meta): dark-mode clients that force-invert can't wreck the contrast we checked.
 */
const EMAIL_COLORS = {
  page: "#dde8f7", // sky-day
  card: "#ffffff",
  band: "#1b2a4a", // night
  bandText: "#f5c451", // gold-light
  text: "#1b2a4a", // night (light-mode foreground)
  muted: "#42537a", // light-mode muted
  button: "#e0a526", // gold (site primary button)
  buttonText: "#1b2a4a",
  rule: "#e2e8f0",
} as const;
// Web fonts (Fraunces / Nunito Sans) don't load in most mail apps: use the closest system fonts.
const HEADING_FONT = "Georgia,'Times New Roman',serif";
const BODY_FONT = "'Segoe UI',Helvetica,Arial,sans-serif";
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
  const c = EMAIL_COLORS;
  const html = `<!doctype html>
<html lang="${safeLocale}"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:24px 12px;background:${c.page};font-family:${BODY_FONT};color:${c.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:${c.card};border-radius:12px;overflow:hidden">
<tr><td style="padding:18px 28px;background:${c.band}">
<p style="margin:0;font-family:${HEADING_FONT};font-size:18px;font-weight:bold;color:${c.bandText}">&#10022; Spirit of Santa</p>
</td></tr>
<tr><td style="padding:24px 28px">
<h1 style="margin:0 0 16px;font-family:${HEADING_FONT};font-size:24px;line-height:1.25;color:${c.text}">${e(heading)}</h1>
<p style="margin:0 0 22px;line-height:1.55;white-space:pre-line">${e(body)}</p>
<p style="margin:0 0 22px"><a href="${e(link)}" style="display:inline-block;background:${c.button};color:${c.buttonText};text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">${e(button)}</a></p>
${expiry ? `<p style="margin:0 0 12px;color:${c.muted};font-size:14px">${e(expiry)}</p>` : ""}
<p style="margin:0 0 4px;color:${c.muted};font-size:13px">${e(tt("linkFallback"))}</p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all"><a href="${e(link)}" style="color:${c.text}">${e(link)}</a></p>
${showIgnore ? `<p style="margin:0;color:${c.muted};font-size:13px">${e(tt("ignore"))}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;color:${c.muted};font-size:12px;line-height:1.5;border-top:1px solid ${c.rule}">${e(tt("footer"))}${
    optOut ? `<br><a href="${e(optOut.stop)}" style="color:${c.muted}">${e(tt("optOut"))}</a> · <a href="${e(optOut.manage)}" style="color:${c.muted}">${e(tt("manage"))}</a>` : ""
  }</td></tr>
</table></body></html>`;

  return { subject, text, html };
}

/**
 * The per-child lines of a daily summary, in the parent's language, e.g.
 * "Maya: 12.5 Christmas Magic · 1 good deed thanked" (points are called "Christmas Magic" in all copy;
 * user 2026-11-06). The amount is formatted HERE in the reader's number format.
 */
export function digestLines(locale: unknown, rows: { kid: string; centipoints?: number; deeds?: number }[]): string {
  const safeLocale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = createTranslator({ locale: safeLocale, messages: MESSAGES[safeLocale], namespace: "Email" }) as unknown as (key: string, v?: Record<string, string | number>) => string;
  return rows
    .map((r) => {
      const parts = [(r.centipoints ?? 0) > 0 ? t("familyDigest.magic", { points: formatPoints(r.centipoints!, intlLocale(safeLocale)) }) : "", r.deeds ? t("familyDigest.deeds", { count: r.deeds }) : ""].filter(Boolean);
      return `${r.kid}: ${parts.join(" · ")}`;
    })
    .join("\n");
}
