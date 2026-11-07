# Security headers & Content-Security-Policy (CSP)

Saved 2026-11-06 for Phase 8 slice 1. Code: `packages/lib/src/security-headers.ts`, used by each app's `next.config.ts`.

## Next.js 16.4.5 (source: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)

Three options:

1. **Nonces** (strictest: `script-src 'nonce-…' 'strict-dynamic'`, set in proxy.ts). Requires DYNAMIC rendering of
   every page; "Partial Prerendering (PPR) is incompatible with nonce-based CSP". We use cacheComponents +
   partialPrerendering, so NOT chosen (would make every page render per request: slower, costlier).
2. **Without nonces** (chosen): static header from `next.config` `headers()`. `script-src 'self' 'unsafe-inline'`
   (Next writes inline bootstrap/flight scripts), `'unsafe-eval'` in dev only (React dev tools / HMR).
3. **SRI** (`experimental.sri`): hashes for script FILES at build time. Experimental, and Next's inline flight
   scripts still need allowing. Revisit when stable; it could let us drop 'unsafe-inline' later.

What the no-nonce CSP still protects: frame-ancestors (clickjacking), object-src 'none' (plugins), base-uri (base-tag
hijack), form-action (forms can't post to other sites), where scripts/frames/images/connections may come from
(an injected `<script src=evil>` is blocked; injected INLINE script is not: React escaping is the main XSS guard).

`upgrade-insecure-requests` and HSTS only in production (dev runs on http://localhost).

## Stripe (source: https://docs.stripe.com/security/guide#content-security-policy, fetched 2026-11-06)

We use **Embedded Checkout** (`@stripe/react-stripe-js` EmbeddedCheckout) = Stripe.js + Checkout (+ Link inside it):

- Checkout: connect-src, frame-src, script-src `https://checkout.stripe.com`; img-src `https://*.stripe.com`
- Stripe.js: connect-src `https://api.stripe.com` (`https://maps.googleapis.com` only for Address Element with own
  Maps key: NOT used); frame-src `https://*.js.stripe.com https://js.stripe.com https://hooks.stripe.com` (hooks =
  3D Secure / redirect methods); script-src `https://*.js.stripe.com https://js.stripe.com`
- Link: frame-src + connect-src `https://link.com https://*.link.com`; img-src `https://*.link.com`
- Stripe does NOT support cross-origin isolation (no COEP). COOP `same-origin-allow-popups` keeps popups working.
- Don't block the `payment` permission (Apple/Google Pay inside Stripe's iframe use the Payment Request API).
- Webhooks: verify signatures (we do: packages/payments), TLS endpoint.

## Other headers

- `Strict-Transport-Security: max-age=63072000` on Vercel only (2 years, this host; no includeSubDomains/`preload`:
  preload is hard to undo).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (old browsers; CSP frame-ancestors is the modern one).
- `Referrer-Policy: strict-origin-when-cross-origin`: other sites see only our origin, never token paths like
  /k/<token> or /reset-password?token=.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()` (we use none of them).

## Vercel toolbar on PREVIEW deployments (source: https://vercel.com/docs/vercel-toolbar/managing-toolbar, fetched 2026-11-06)

script-src/frame-src `https://vercel.live`; connect-src `https://vercel.live wss://ws-us3.pusher.com`; img-src
`https://vercel.live https://vercel.com`; style-src `https://vercel.live`; font-src `https://vercel.live
https://assets.vercel.com`. Added only when `VERCEL_ENV=preview`. E2E against a preview: send header
`x-vercel-skip-toolbar: 1` to keep the toolbar out of the way.

## Environment switches (nextSecurityHeaders)

`NODE_ENV=development` → 'unsafe-eval'. `VERCEL=1` → upgrade-insecure-requests + HSTS (local `next start` on http
stays usable). `VERCEL_ENV=preview` → toolbar origins. HSTS is `max-age=63072000` only (no includeSubDomains/preload:
review findings 2026-11-06: would lock unknown subdomains to HTTPS for 2 years).
