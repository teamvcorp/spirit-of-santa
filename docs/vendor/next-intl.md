# next-intl 4 — project notes

Pinned: **next-intl 4.14.9** (2026-10-02; peer `next ^12–16`). Upstream: https://next-intl.dev.
Chosen over the roadmap's next-i18next, which targets the Pages Router. Next 16's own guide
(`node_modules/next/dist/docs/01-app/02-guides/internationalization.md`) lists it.
Verified against the installed `.d.ts`, Next's bundled docs, and a production smoke test.

## How this repo uses it

| Piece | Where |
|---|---|
| Locale list, `isLocale`, labels | `packages/lib/src/locales.ts` (also used by DB `locale` enums) |
| Routing factory `createRouting(app)` | `packages/i18n/src/routing.ts` |
| Request config factory | `packages/i18n/src/request.ts` (merges `Common` + app messages, sets time zone) |
| Proxy factory | `packages/i18n/src/proxy.ts` |
| Shared strings (`Common.*`) | `packages/i18n/messages/{en,es}.json` |
| Non-render translations (SMS/push/email) | `packages/i18n/src/server.ts` → `getCommonTranslator(locale, ns)` |
| Language switcher | `packages/i18n/src/locale-switcher.tsx` (`"use client"`) |
| Per app | `i18n/routing.ts`, `i18n/request.ts`, `i18n/navigation.ts`, `proxy.ts`, `global.d.ts`, `messages/`, `app/[locale]/…` |
| Parity test | `packages/i18n/test/i18n.test.ts`: same keys + ICU placeholders in every locale, every app |

## Behaviour (verified on a production build of `family`)

- `localePrefix: "as-needed"`: English `/`, Spanish `/es`. `/en/x` → 307 to `/x`.
- A prefix-less URL picks the cookie, then `Accept-Language`, then English (`es-MX` → 307 `/es`).
- Locale cookie: `__Host-sos-<app>.locale` in production (Secure, SameSite=lax, 1 year),
  `sos-<app>.locale` in dev. It's set whenever a prefixed URL is visited, so the switcher works.
- The proxy sets `Link: rel="alternate" hreflang` headers (SEO) on every page.
- `/api/*` is excluded from the proxy matcher (NextAuth, webhooks stay locale-free).
  So are the generated icons `/icon/<size>` and `/apple-icon` (no dot in their URLs, so they
  were getting a locale prefix and 404ing; fixed 2026-11-05). Any new dot-less metadata route
  (e.g. `opengraph-image`) needs adding to the matcher too.
- Pages under `[locale]` prerender statically (`/en`, `/es` show as ○ in the build).

## Rules / gotchas

- **Locale comes from `next/root-params`** (`import { locale } from "next/root-params"`),
  which is what keeps pages static under Cache Components. Root params do **not** work in
  Server Actions or Route Handlers: there use `getTranslations({ locale, namespace })` with
  a locale you validated (usually the user's saved `User.locale`).
- **`generateStaticParams` is required** in `app/[locale]/layout.tsx` with Cache Components.
- **Unknown URLs** need `app/[locale]/[...rest]/page.tsx` calling `notFound()`; otherwise Next
  shows its bare untranslated 404. Under Cache Components the 404 is sent as a shell (404
  status + noindex) and the browser streams in the translated content; curl sees no text.
- **proxy.ts `config.matcher` must be a literal** in the app file (Next reads it statically).
- **Never build a file path from the locale**: message loaders are static `{ en, es }` maps,
  and every locale passes `isLocale()` first.
- **Apps must not define a top-level `Common` key** (the test enforces it); it would be
  overwritten by the shared one.
- **Typed keys**: `global.d.ts` augments `next-intl`'s `AppConfig` with the English JSON types,
  so `t("Typo")` fails `check-types`.
- `NextIntlClientProvider` with no props inherits locale + **all** messages from the server.
  Fine while messages are small; later pass only the namespaces client components need.
- `timeZone` is fixed to `America/Chicago` (`SEASON_TIME_ZONE`) so server and browser format
  dates identically (avoids hydration mismatches).
- ICU plurals: `"{count, plural, one {# point} other {# points}}"` → `t("points", { count })`.
- Install scripts for `@swc/core` / `@parcel/watcher` (next-intl's optional message extractor)
  are blocked by npm's allowScripts; nothing we use needs them.

## Adding a language

1. Add the code to `LOCALES` in `packages/lib/src/locales.ts` (+ `LOCALE_LABELS`).
2. Add `<code>.json` to `packages/i18n/messages/` and each `apps/*/messages/`.
3. Add it to the static loader maps (`packages/i18n/src/messages.ts`, each `apps/*/i18n/request.ts`).
4. `npm run test` — the parity test lists anything missing.
