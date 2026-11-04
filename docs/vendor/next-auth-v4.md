# NextAuth.js v4 — project notes

Pinned: **next-auth 4.24.15** (stable; supports Next 12–16, React 17–19). v5 ("Auth.js") is
still `5.0.0-beta.x` as of 2026-11; revisit when it ships stable. Upstream docs:
https://next-auth.js.org (v4). Verified against the installed package's `.d.ts` and source.

## How this repo uses it (packages/auth)

| Piece | Where |
|---|---|
| Config factory `createAuthOptions(app)` | `packages/auth/src/options.ts` |
| Per-app options | `apps/<app>/auth.ts` → `export const authOptions` |
| Route handler | `apps/<app>/app/api/auth/[...nextauth]/route.ts` (`export { handler as GET, handler as POST }`) |
| Read session (server) | `getServerSession(authOptions)` from `next-auth/next`, wrapped by `getSessionUser / requireUser / requireRole` |
| Types | module augmentation of `next-auth` `User`/`Session` and `next-auth/jwt` `JWT` in options.ts |

## v4 facts that matter

- **App Router compatible:** 4.24.x awaits `cookies()`, `headers()` and `context.params` (Next 15+ async APIs).
- **Errors thrown in `authorize()` are put in the redirect URL** (`/api/auth/error?error=<message>`).
  Always catch and return `null`; we log server-side. (Found in our smoke test.)
- **Credentials provider forces JWT sessions** (no DB sessions). Revocation is our job: the jwt
  callback re-checks `User.status` / `sessionVersion` every 5 min and marks the token `invalid`.
- **CSRF**: built in for sign-in/sign-out POSTs (`/api/auth/csrf` double-submit cookie). A POST
  without the token redirects to `/api/auth/signin?csrf=true`.
- **`secret`**: required in production (`NO_SECRET` error). Use a different `NEXTAUTH_SECRET`
  per app. Our parent-PIN HMAC key is derived from it via HKDF (separate purpose label).
- **Cookies**: default names collide across apps on localhost (cookies ignore ports), so we set
  per-app names; production uses the `__Host-` prefix (Secure, no Domain → host-only).
- **Default pages**: `/api/auth/signin` is a built-in unstyled form. Replace via `pages.signIn`
  when the app has its own login UI.
- **Middleware (`next-auth/middleware` `withAuth`)**: not used. Next 16 renamed middleware → proxy,
  and auth must be checked at the data access point anyway (CVE-2025-29927).

## Cache Components caveat (apps have `cacheComponents: true`)

`getServerSession` reads cookies → it's request-time data. Call it inside a component wrapped in
`<Suspense>` (or in Server Actions / Route Handlers), never inside a `"use cache"` scope.
