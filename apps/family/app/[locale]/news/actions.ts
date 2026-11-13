"use server";
/**
 * News sign-up (owner 2026-11-12). Public Server Actions (no account): Zod-validated, rate-limited and padded to
 * the same response time whatever the outcome, so they never reveal whether an address is already subscribed.
 * Rules + Resend sync: @repo/auth/news.
 */
import { headers } from "next/headers";
import { z } from "zod";
import { confirmNews, requestNews } from "@repo/auth/news";
import { emailSchema } from "@repo/auth/schemas";
import { DEFAULT_LOCALE, LOCALES } from "@repo/lib/locales";

export type NewsSignupState = { status: "idle" | "sent" } | { status: "error"; error: "invalid" | "adult" | "rateLimited"; email: string; nonce: number };
export type NewsConfirmState = { status: "idle" | "done" | "invalidLink" };

const signupSchema = z.object({
  email: emailSchema,
  // The unticked "I'm 18 or older and want news" box: required (children are never subscribers).
  adult: z.literal("on"),
  // Honeypot: real people never see or fill it. Never "invalid" (that would tell a bot it was caught).
  company_url: z.string().max(200).optional().catch("caught"),
  locale: z.enum(LOCALES).catch(DEFAULT_LOCALE),
});

/** Same minimum response time on every path (no timing hint about the address). */
async function atLeast<T>(work: Promise<T>, ms = 1500): Promise<T> {
  const [r] = await Promise.all([work, new Promise((res) => setTimeout(res, ms))]);
  return r;
}

export async function newsSignupAction(_prev: NewsSignupState, fd: FormData): Promise<NewsSignupState> {
  const text = (k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");
  const parsed = signupSchema.safeParse({ email: text("email"), adult: fd.get("adult") ?? undefined, company_url: text("company_url"), locale: text("locale") });
  const echo = { email: text("email").slice(0, 254), nonce: Date.now() };
  if (!parsed.success) {
    const bad = parsed.error.issues[0]?.path[0];
    return { status: "error", error: bad === "adult" ? "adult" : "invalid", ...echo };
  }
  const appOrigin = process.env.NEXTAUTH_URL;
  if (!appOrigin) throw new Error("NEXTAUTH_URL is not set"); // links need this app's public origin
  const r = await atLeast(requestNews(parsed.data.email, { headers: await headers(), locale: parsed.data.locale, appOrigin }, parsed.data.company_url));
  return r.ok ? { status: "sent" } : { status: "error", error: r.error, ...echo };
}

export async function newsConfirmAction(_prev: NewsConfirmState, fd: FormData): Promise<NewsConfirmState> {
  return (await confirmNews(fd.get("token"))) ? { status: "done" } : { status: "invalidLink" };
}
