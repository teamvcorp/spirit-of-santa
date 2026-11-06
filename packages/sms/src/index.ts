/**
 * Text messages via Twilio (Phase 5 slice 4b). SERVER-ONLY (credentials never reach a browser).
 * Our only text is the pay-later tip link, REGISTERED with the carriers (Toll-Free Verification,
 * docs/vendor/twilio.md): one message per request, no marketing.
 *
 * - REST API, one HTTPS call (no SDK): POST /2010-04-01/Accounts/{AccountSid}/Messages.json with
 *   To, From (or MessagingServiceSid), Body. Auth: an API key (TWILIO_API_KEY_SID + _SECRET,
 *   preferred: revocable on its own) or the account's Auth Token.
 * - Development: PRINTS the text to the server console instead of sending (like @repo/email),
 *   unless TWILIO_DEV_SEND=true. Production without credentials THROWS (never silently dropped).
 * - Never log the body or the full number (the body holds a payment link).
 */
import "server-only";

export class SmsError extends Error {
  /** Twilio error code (e.g. 21610 = recipient replied STOP), or 0 when unknown. */
  readonly code: number;
  // (No constructor "parameter properties": Node's built-in TypeScript stripping can't run them.)
  constructor(code: number, message: string) {
    super(message);
    this.name = "SmsError";
    this.code = code;
  }
}

export type SmsFailure = "optedOut" | "badNumber" | "unavailable";

/**
 * Twilio error code → what we tell the visitor. Pure (unit-tested).
 * 21610 unsubscribed (replied STOP) · 21211 invalid To · 21614 not a mobile · 21408 region not
 * enabled · 21612 can't route to this number · everything else = temporarily unavailable.
 */
export function smsFailureFor(code: number): SmsFailure {
  if (code === 21610) return "optedOut";
  if (code === 21211 || code === 21614 || code === 21612 || code === 21408) return "badNumber";
  return "unavailable";
}

const env = (k: string) => process.env[k]?.trim() || undefined;

/** Send one text. Returns Twilio's message SID ("dev-…" when printed in development). */
export async function sendSms(input: { to: string; body: string }): Promise<{ sid: string }> {
  if (!/^\+1\d{10}$/.test(input.to)) throw new SmsError(21211, "invalid destination");
  const isProd = process.env.NODE_ENV === "production";
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (!isProd && process.env.TWILIO_DEV_SEND !== "true") {
    console.info(`\n[sms:dev] to=…${input.to.slice(-4)} (${input.body.length} chars)\n${input.body}\n[sms:dev] ---- end\n`);
    return { sid: `dev-${Date.now()}` };
  }
  const account = env("TWILIO_ACCOUNT_SID");
  const keySid = env("TWILIO_API_KEY_SID");
  const keySecret = env("TWILIO_API_KEY_SECRET");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const service = env("TWILIO_MESSAGING_SERVICE_SID");
  const from = env("TWILIO_PHONE_NUMBER");
  const user = keySid && keySecret ? keySid : account;
  const pass = keySid && keySecret ? keySecret : authToken;
  if (!account?.startsWith("AC") || !user || !pass || (!service && !from)) throw new Error("Twilio is not configured (see docs/vendor/twilio.md)");
  if (from && !/^\+1\d{10}$/.test(from)) throw new Error("TWILIO_PHONE_NUMBER must be E.164, e.g. +18445550123");

  const params = new URLSearchParams({ To: input.to, Body: input.body });
  if (service) params.set("MessagingServiceSid", service);
  else params.set("From", from!);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
  if (!res.ok || !json.sid) throw new SmsError(Number(json.code) || 0, `Twilio ${res.status}: ${String(json.message ?? "").slice(0, 120)}`);
  return { sid: json.sid };
}
