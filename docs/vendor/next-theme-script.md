# Next.js 16: theme without a flash (local notes)

Source: `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` (Next 16.4.5, read 2026-11-08).

- Render a default on the server: `<html data-theme="winter" suppressHydrationWarning>`.
- In `<head>`, add `<script dangerouslySetInnerHTML={{ __html: "(function(){try{…localStorage…setAttribute('data-theme',t)}catch(e){}})()" }} />`.
  It runs during HTML parsing, so it applies before the first paint, even before React loads. Always validate the stored value.
- `suppressHydrationWarning` on `<html>` lets React accept the attribute the script changed.
- **Don't read `cookies()` in the root layout.** With Cache Components that makes every page under it blocking/dynamic.
  If a cookie is used, read it in the inline script instead.
- **Dev only:** React Strict Mode re-mounts and resets `<html>`'s attributes to the JSX ones. Re-apply the stored value in
  the switch component's `useLayoutEffect` (a no-op in production).
- `useEffect` would flash (it runs after paint). `useLayoutEffect` alone still flashes before React hydrates, so the
  inline script is needed.
- CSP: inline scripts need `'unsafe-inline'` or a nonce. Our CSP allows `'unsafe-inline'` (pages are prerendered,
  so no nonces), see packages/lib/src/security-headers.ts.
