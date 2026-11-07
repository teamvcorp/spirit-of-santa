/**
 * Security headers for every response of every app (Phase 8 slice 1). Each app's next.config.ts does
 * `headers: () => nextSecurityHeaders({ stripe })`. Research + reasons: docs/vendor/security-headers.md.
 *
 * Teaching notes:
 * - CSP (Content-Security-Policy) tells the browser where a page may load scripts, frames, images and
 *   connections from. If an attacker manages to inject `<script src="https://evil…">` or an <iframe>,
 *   the browser refuses to load it.
 * - We can't use the strictest CSP (per-request "nonces"): it needs every page rendered per request, and
 *   our Partial Prerendering serves pre-built page shells. So inline scripts stay allowed ('unsafe-inline';
 *   Next writes some itself). React's automatic escaping remains the main defence against injected HTML.
 * - Only the family app takes payments, so only it allows Stripe's origins (`stripe: true`).
 */

export type SecurityHeaderOptions = {
  /** Allow Stripe Embedded Checkout (Stripe.js + Checkout + Link). Family app only. */
  stripe?: boolean;
  /** Development server: allow eval (React dev tooling / hot reload). */
  dev?: boolean;
  /**
   * Served over HTTPS (on Vercel): add upgrade-insecure-requests + HSTS. Off for local `next start` on
   * http://localhost, where some browsers would "upgrade" our own files to https and break the page.
   */
  https?: boolean;
  /** Vercel PREVIEW deployment: allow the Vercel toolbar/comments (never in production). */
  preview?: boolean;
};

// Official lists (copied in docs/vendor/security-headers.md):
// Stripe: https://docs.stripe.com/security/guide#content-security-policy
const STRIPE = {
  script: ["https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com"],
  frame: ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"],
  connect: ["https://api.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"],
  img: ["https://*.stripe.com", "https://*.link.com"],
};
// Vercel toolbar: https://vercel.com/docs/vercel-toolbar/managing-toolbar#using-a-content-security-policy
const VERCEL_TOOLBAR = {
  script: ["https://vercel.live"],
  connect: ["https://vercel.live", "wss://ws-us3.pusher.com"],
  img: ["https://vercel.live", "https://vercel.com"],
  frame: ["https://vercel.live"],
  style: ["https://vercel.live"],
  font: ["https://vercel.live", "https://assets.vercel.com"],
};

/** The CSP header value (one line). Exported for tests. */
export function contentSecurityPolicy({ stripe = false, dev = false, https = false, preview = false }: SecurityHeaderOptions = {}): string {
  const s = (list: string[]) => (stripe ? list : []);
  const v = (list: string[]) => (preview ? list : []);
  const frames = [...s(STRIPE.frame), ...v(VERCEL_TOOLBAR.frame)];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...s(STRIPE.script), ...v(VERCEL_TOOLBAR.script)]],
    // Inline styles: React style={{…}} attributes and Next's injected styles.
    ["style-src", ["'self'", "'unsafe-inline'", ...v(VERCEL_TOOLBAR.style)]],
    // data: = QR codes (data URLs); blob: = local photo previews before upload.
    ["img-src", ["'self'", "data:", "blob:", ...s(STRIPE.img), ...v(VERCEL_TOOLBAR.img)]],
    ["font-src", ["'self'", ...v(VERCEL_TOOLBAR.font)]], // next/font serves our fonts from our own origin
    ["connect-src", ["'self'", ...s(STRIPE.connect), ...v(VERCEL_TOOLBAR.connect)]],
    ["frame-src", frames.length ? frames : ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Forms may only submit to us (Server Actions are same-origin; Stripe is embedded, not a form post).
    ["form-action", ["'self'"]],
    // Nobody may put our pages in a frame (clickjacking: tricking a parent into clicking "pay").
    ["frame-ancestors", ["'none'"]],
  ];
  const lines = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (https) lines.push("upgrade-insecure-requests");
  return lines.join("; ");
}

/** All headers as name/value pairs. */
export function securityHeaders(options: SecurityHeaderOptions = {}): { key: string; value: string }[] {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" }, // never guess a file's type (e.g. run text as script)
    { key: "X-Frame-Options", value: "DENY" }, // older browsers' version of frame-ancestors 'none'
    // Other sites see only "https://www.spiritofsanta.com", never paths with tokens (/k/<token>, reset links).
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // We use none of these. `payment` is left alone: Apple/Google Pay inside Stripe's frame need it.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    // Keeps other windows from scripting ours; "allow-popups" so Stripe/Link pop-ups still work.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
  if (options.https) {
    // HTTPS only for 2 years for THIS host (same as Vercel's default). No includeSubDomains/preload: they would
    // force every present and future subdomain (e.g. email link tracking) onto HTTPS, undoable for 2 years.
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000" });
  }
  return headers;
}

/**
 * The whole next.config `headers()` answer, so the three apps stay identical:
 *   headers: () => nextSecurityHeaders({ stripe: true })
 * Environment detection lives here: NODE_ENV=development → dev; VERCEL=1 (set on every Vercel build/run) →
 * https; VERCEL_ENV=preview → preview toolbar allowed.
 */
export async function nextSecurityHeaders(options: Pick<SecurityHeaderOptions, "stripe"> = {}) {
  const env = process.env;
  const headers = securityHeaders({
    stripe: options.stripe,
    dev: env.NODE_ENV === "development",
    https: env.VERCEL === "1",
    preview: env.VERCEL_ENV === "preview",
  });
  return [{ source: "/:path*", headers }];
}
