/**
 * Security headers for every response of every app (Phase 8 slice 1). Each app's next.config.ts calls
 * `securityHeaders({ stripe })` inside `headers()`. Research + reasons: docs/vendor/security-headers.md.
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
  /** Development server: allow eval (React dev tooling) and skip https-only rules (dev is http://localhost). */
  dev?: boolean;
};

// Official lists: https://docs.stripe.com/security/guide#content-security-policy (copied in docs/vendor).
const STRIPE = {
  script: ["https://js.stripe.com", "https://*.js.stripe.com", "https://checkout.stripe.com"],
  frame: ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"],
  connect: ["https://api.stripe.com", "https://checkout.stripe.com", "https://link.com", "https://*.link.com"],
  img: ["https://*.stripe.com", "https://*.link.com"],
};

/** The CSP header value (one line). Exported for tests. */
export function contentSecurityPolicy({ stripe = false, dev = false }: SecurityHeaderOptions = {}): string {
  const s = (list: string[]) => (stripe ? list : []);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...s(STRIPE.script)]],
    // Inline styles: React style={{…}} attributes and Next's injected styles.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // data: = QR codes (data URLs); blob: = local photo previews before upload.
    ["img-src", ["'self'", "data:", "blob:", ...s(STRIPE.img)]],
    ["font-src", ["'self'"]], // next/font serves the fonts from our own origin
    ["connect-src", ["'self'", ...s(STRIPE.connect)]],
    ["frame-src", stripe ? STRIPE.frame : ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Forms may only submit to us (Server Actions are same-origin; Stripe is embedded, not a form post).
    ["form-action", ["'self'"]],
    // Nobody may put our pages in a frame (clickjacking: tricking a parent into clicking "pay").
    ["frame-ancestors", ["'none'"]],
  ];
  const lines = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!dev) lines.push("upgrade-insecure-requests");
  return lines.join("; ");
}

/** All headers, in the shape next.config `headers()` wants. */
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
  if (!options.dev) {
    // HTTPS only for 2 years, subdomains too (store., admin.). No "preload": hard to undo; owner's call.
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}
