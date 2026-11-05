# turboSanta CODEMAP

> Read this before exploring. Keep it current when packages/routes are added.
> Last updated: 2026-11-05. Status: **Phase 1: shared packages, i18n, sign-in, image storage, home-screen icons done; placeholder pages otherwise.**
> Rules/constants: [../CLAUDE.md](../CLAUDE.md). Roadmap: [../SpiritOfSanta.md](../SpiritOfSanta.md).

## Layout

| Path | What |
|---|---|
| `apps/family` :3000 | Next 16 app. `auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `proxy.ts` (locale), `i18n/`, `messages/`, `app/[locale]/` (layout, placeholder page, not-found, `[...rest]` catch-all), `app/icon.tsx` + `apple-icon.tsx` + `manifest.ts`, `app/api/webhooks/stripe/route.ts` |
| `apps/store` :3001 | Same skeleton |
| `apps/admin` :3002 | Same skeleton (+ `robots: noindex`). Dashboard (pending count), `stores/` queue, `stores/[id]` detail + actions, `stores/invite`, `stores/actions.ts` (admin Server Actions) |
| `packages/lib` | Client-safe: `season`, `roles`, `limits`, `format`, `locales`, `cookies`. **Server-only:** `constants`, `points` |
| `packages/i18n` | next-intl factories (routing, request, proxy), `Common` messages, `LocaleSwitcher`, `getCommonTranslator` for SMS/push |
| `packages/db` | `connectDb()`, `withTransaction()` + 12 Mongoose models incl. `Payment` (money records) and `StripeEvent` (webhook log) (server-only) |
| `packages/email` | **Server-only** `sendEmail()` via Resend + pure `renderEmail()` templates (en/es, escaped, link allow-list). Dev prints instead of sending |
| `packages/stores` | **Server-only** store business logic: `admin.ts` (approve/reject/suspend/reinstate/discount/invite: atomic transitions + AuditLog + owner emails), `queries.ts` (queue, detail), `schemas.ts` (discount % → bps), `urls.ts` (STORE_APP_URL) |
| `packages/payments` | **Server-only** Stripe: `client` (`getStripe`, `expectedLivemode`), `metadata` (`sos_*` payment-label contract), `webhook` (verify → dedupe → `handlers`) |
| `packages/auth` | NextAuth v4 options, guards, argon2id hashing, parent PIN (server-only); UI: `SignInSlot`/`SignInForm`, `AccountMenu`, `SignOutButton`; `safeCallbackPath` (open-redirect guard); `scripts/seed-dev.ts`; account flows (`account-flows.ts`: store sign-up, verify, resend, forgot/reset), `tokens.ts` (hashed single-use links), `rate-limit.ts`, `schemas.ts`, shared forms (`forms.tsx`, `token-slot.tsx`, `form-actions.ts`) |
| `packages/ui` | Button, TextField, Card, Alert, SiteHeader, `cn`, `theme.css` (brand tokens, `danger`, focus ring), `app-icon` (icon art + manifest factory) |
| `packages/storage` | **Server-only** `images` (`uploadPublicImage`/`deletePublicImage` on public Vercel Blob, sharp re-encode); client-safe `image-rules` (limits, magic-byte sniff, `blobImagesConfig` for next.config) |
| `packages/eslint-config` | `./base` (packages), `./next-js` (apps). only-warn + `--max-warnings 0` |
| `packages/typescript-config` | `base`, `nextjs` (apps), `library` (lib/db/auth), `react-library` (ui) |
| `docs/vendor/` | Version-specific notes: `mongoose-9.md`, `next-auth-v4.md`, `next-intl.md`, `vercel-blob.md` (also icons), `stripe.md`, `resend.md` |

## Key decisions (why things look the way they do)

- **Units:** money = integer **cents**; points = integer **centipoints** (1 pt = 100). Tip→points
  rounds down, points→money rounds up, item cost in centipoints = retail cents. (`packages/lib/src/points.ts`)
- **Server-only enforcement:** `import "server-only"` in constants/points/db/auth makes a client
  import a build error (verified).
- **Season dates** are evaluated in `America/Chicago` (`SEASON_TIME_ZONE`). DB `Season` doc overrides defaults.
- **Roles:** `child | parent | store_owner | store_rep | admin`; `APP_ROLES` limits which roles may sign in per app.
  Kids are `Kid` records, not Users (COPPA). Community tippers have no account.
- **Ledger:** `Transaction` is append-only (Mongoose middleware) with `idempotencyKey` unique index.
  Kid balances are a cache; change them only with ledger inserts in one DB transaction.
- **Mongoose globals:** `sanitizeFilter: true` (wrap OUR operators in `trusted()`), `strictQuery: "throw"`.
- **Auth:** credentials + JWT, per-app cookies (`__Host-` in prod), 5-try/15-min lockout, timing-equalised
  unknown-email path, 5-min revocation re-check via `User.sessionVersion`, generic errors only.
- **Parent PIN:** argon2id hash on Family, own lockout, 15-min HMAC-signed unlock cookie bound to family+user.
- **i18n:** English at `/`, Spanish at `/es` (next-intl, `as-needed`). Locale read via
  `next/root-params` so pages stay static. All UI text goes in `messages/*.json`, never inline;
  shared strings live in `Common`. Parity test fails on any missing Spanish key. See `docs/vendor/next-intl.md`.
- **Images (2026-11-05):** public Vercel Blob store, product/store photos ONLY (never kids/families/documents).
  Every upload is size-capped (4 MB), type-checked by magic bytes, re-encoded to WebP with EXIF/GPS
  stripped, and stored as `<folder>/<ownerId>/<uuid>.webp`. DB keeps `{ url, pathname }`. See `docs/vendor/vercel-blob.md`.
- **Payments (2026-11-05):** Stripe webhook credits tips/bonuses (ledger + balance + deed in one DB transaction,
  idempotent per PaymentIntent). **No refunds at all**: refunds/chargebacks recorded on `Payment` + flagged, points kept.
  Donations/pay-ups recorded as "held" until Phases 5–6. See `docs/vendor/stripe.md`.
- **No PWA (2026-11-05):** home-screen icon only (`display: "browser"` manifest, no service worker).
- **TS source packages:** no build step; Next transpiles them. Relative imports use `.ts` extensions
  (Node type-stripping for tests). Mongoose must be default-imported (CJS) in packages/db.

## Toolchain (pinned)

Node >= 24.7 (built-in `crypto.argon2`) · npm 11 · Next 16.4.5 · React 19.3.1 · **TypeScript 6.0.3**
(not 7: typescript-eslint rejects TS 7; revisit when supported) · ESLint 9.39.5 · Mongoose 9.11.4 ·
next-auth 4.24.15 · Zod 4.6.7 · Turbo 2.11.

Turbo `transit` task makes app builds/checks re-run when internal packages change. **Without it
the app build cache goes stale** (seen while building this).

## Commands

`npm run dev | build | lint | check-types | test` (via turbo). One workspace: `--filter=family`.
Tests: Node's built-in runner (`node --conditions=react-server --test`), no DB required.

**Dev database + test accounts:** local `.env.local` files use database `spiritofsanta_dev`
(Vercel uses `spiritofsanta`). `npm run seed:dev` (needs `SEED_PASSWORD`, 12+ chars) creates
`dev-parent@`, `dev-owner@`, `dev-rep@`, `dev-admin@spiritofsanta.test` + a Dev Family and
Dev Toy Shop; refuses any DB not ending in `_dev`. `npm run seed:dev -- --remove` deletes them.

**E2E scripts:** `scripts/e2e/signin.mjs`, `roles.mjs` (need seeded users), `stripe-webhook.ts` (self-contained,
creates + deletes its own fixtures in the `_dev` DB; `--real-stripe` adds a real test payment). Usage in file headers.

**PowerShell 5 gotcha:** `Set-Content -Encoding utf8` writes a BOM (breaks some JSON parsers). Use the Write tool
or `[IO.File]::WriteAllText(path, text, (New-Object Text.UTF8Encoding $false))`.

**Local server gotcha (Windows):** `netstat`/`Get-NetTCPConnection` may not show a `next start`
listener. Find strays with `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` and match
the command line; stop by PID only. Old servers silently answer tests with stale builds.

## Local docs (read before guessing)

- Next.js 16: `node_modules/next/dist/docs/` (breaking changes vs. training data)
- Turborepo: `node_modules/turbo/docs/`
- Our notes: `docs/vendor/*.md`

## Phase 1 status vs. SpiritOfSanta.md (reviewed 2026-11-04)

Done: monorepo, CLAUDE.md, full schema, NextAuth roles, parent PIN, i18n (en/es).

**Accounts:** Atlas ✅ (cluster `santaadmin.10ptpiw`, db `spiritofsanta`, per-app `.env.local`, ping OK).
Stripe test keys ✅ (family + store; remove from store). NEXTAUTH_SECRET ✅ (all 3). Vercel Blob ✅ (public store;
`BLOB_*` in store `.env.local`). **Still blank:** Twilio, FCM, Vercel projects, domains. Family + admin need
`BLOB_STORE_ID` (not secret) for store photos to display.

**Agreed next order (code):**
1. ✅ i18n with **next-intl** (roadmap said next-i18next, Pages Router only; swap still to confirm with user)
2. ✅ Shared UI components + sign-in pages per app (e2e-tested against Atlas dev DB, all 3 apps)
3. ✅ Image upload helper: **Vercel Blob (public)** instead of Cloudinary (`packages/storage`; live round trip verified)
4. ✅ Seed script + end-to-end login test (pulled forward). `scripts/e2e/signin.mjs` and `roles.mjs`
   run against a started app (usage in file headers); not in CI yet (needs a dev DB in CI).
5. ✅ Home-screen icons + manifest (user: no installable app, so no Serwist/offline). FCM push moved to Phase 7;
   iOS only allows web push for Home Screen web apps, so plan SMS/email fallback there.

**No Stripe Connect (user decision 2026-11-04):** stores are paid by check or outside the app.
Stripe only collects money (tips, parent bonuses/pay-ups, donations) into the platform account.
Store payouts will need an admin-recorded payout log (TODO below), not Stripe.

**Stripe webhook endpoint (one; route BUILT 2026-11-05, 22/22 E2E incl. a real test payment):**
- `https://spiritofsanta.com/api/webhooks/stripe` (family; "Your account"; snapshot payloads):
  payment_intent.succeeded / .payment_failed / .canceled; checkout.session.completed / .expired /
  .async_payment_succeeded / .async_payment_failed; charge.refunded; charge.dispute.created / .closed
- Its `whsec_` secret → family `STRIPE_WEBHOOK_SECRET` in Vercel; local `.env.local` uses the
  secret printed by `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
- Store app needs **no** Stripe keys (least privilege: remove them from its env). Admin may later
  need `STRIPE_SECRET_KEY` only if refunds are issued from the admin app.
  Stripe doesn't follow redirects, so use the exact canonical host (apex vs www).
- Pay-later 7-day expiry: Payment Links don't expire on their own; our code deactivates them.
- Handler rule: read the raw body, verify the signature first, dedupe on `event.id`, return 2xx fast.
- **Set the endpoint API version to `2026-09-30.endive`** (account default is still 2022-11-15).

Check each library against the bundled Next 16 docs before use; save notes in `docs/vendor/`.
Deadline that matters most: **Store MVP live Jan 1, 2027.**

## Phase 2 decisions (user, 2026-11-05)

- **Email:** Resend, sending domain `fyht4.com` (verified). Default from: `Spirit O Santa <no-reply@fyht4.com>`.
- **Payout:** per-store discount % agreed with admin at approval. Store bills Spirit O Santa the agreed wholesale
  cost (retail − discount); we keep the difference. Stored as integer basis points on Store.
- **Pending/invited stores** may set up profile + items immediately; dashboards show a Pending/Invited badge;
  families see a store only once approved.
- **Pricing:** owners set prices; reps add/edit item details + inventory (rep-created items wait for a price).
- **Agreement wording is a DRAFT** (`StoreAgreement` messages, version `2026-11-05`): user must review before launch.
- Slices: 1 accounts+email (DONE, 349c069) · 2 admin approval/invite (built; review pending) · 3 owner dashboard/reps · 4 item catalog · 5 engagement stats.

## Phase 2 gotchas (learned 2026-11-05)

- **Forms + Cache Components:** a Server Action form submitted BEFORE hydration runs the action,
  but the production response doesn't show its result (dev does). Every form keeps submit
  disabled until hydrated (`@repo/ui/use-hydrated`). Verified with a real browser (Edge).
- **React 19 resets forms after an action:** selects/checkboxes lose echoed defaults. Error
  results carry a `nonce`; the form uses it as `key` to re-mount with the echoed `values`.
- **next-intl embeds ALL messages in the page JSON**: E2E checks must look inside rendered
  `role="alert|status"` boxes (`shown()` in `scripts/e2e/lib.ts`), never `html.includes(text)`.
  Next also renders its own `role="alert"` route announcer: scope browser locators to `main`.
- **`after()`** didn't run reliably in dev for Server Actions; emails are sent inline and
  public account actions are padded to a 1.5 s minimum response (no account enumeration by timing).
- **Next dev-only InvariantError** ("cookies object does not match") from `getServerSession` when
  re-rendering after a no-JS form post: dev-mode code path only; production is clean.
- **Browser E2E:** `playwright-core` (dev dep, no browser download) with `channel: "msedge"`.
  `scripts/e2e/browser-store.ts` runs against `next start`; production SENDS email, so only
  `delivered+...@resend.dev` addresses may receive mail there.
- Sign-in now requires `status: "active"` in every app (pending = email not verified).
- **Account abuse controls (slice 1 review, 2026-11-05):** per-IP limits key IPv6 by /64 (`ipKey`); per-email
  limits are SILENT (answer "sent", skip sending) so strangers can't lock someone out of recovery; sign-up has a
  site-wide cap (100/h); the verification email contains NO user-typed text (anti spam-relay); unconfirmed
  sign-ups are purged after 48 h by Vercel Cron (`apps/store/vercel.json` → `/api/cron/purge-signups`, needs
  `CRON_SECRET` in the store project's env); a locked account burns argon2 time like other failures.
- **Dynamic routes + Cache Components:** any client component using `usePathname()` outside `<Suspense>`
  (our `LocaleSwitcher` in every layout) breaks the PRODUCTION build of dynamic routes like `/stores/[id]`
  (dev doesn't show it). It's wrapped in Suspense in all layouts. Always run a production build.
- **Invites:** admin creates the store as `invited` (no owner yet; `ownerUserId` required only once not invited),
  owner accepts at store `/accept-invite` → one transaction: consume token, create active owner, store → approved.
- **Admin E2E:** `scripts/e2e/browser-admin-stores.ts` (dev: 25 checks incl. emails from the dev log; `--prod`: 15
  checks against `next start`, owner emails go to `delivered+...@resend.dev`).
- **New env:** store `CRON_SECRET` (Vercel cron auth); admin `STORE_APP_URL` (links in invite/approval emails;
  defaults to http://localhost:3001 in dev, required in production).

## Open items / TODO

- **No DB integration test yet.** `connectDb()` and auth flows are untested against a real MongoDB.
  Next: Atlas dev cluster → seed script → sign-in test.
- **Security TODO:** Atlas DB user for the apps should have only `find`/`insert` on `transactions`
  (real ledger immutability); per-IP rate limiting on sign-in & tip endpoints (Vercel Firewall/Upstash);
  admin MFA (roadmap); production `syncIndexes` script (autoIndex is off in prod).
- **Account lockout can be abused** to lock out a known email for 15 min. Acceptable now; per-IP limiting mitigates.
- `npm audit`: 10 moderate (minimatch ReDoS) in the ESLint dev toolchain only, not shipped. Not force-fixed.
- Family (parent) registration + email verification: Phase 4 (store sign-up/verify/reset built in Phase 2 slice 1).
- Home pages are placeholders (title + intro + language switcher); real UI is step 2.
- **Store payout log (not designed yet):** with offline payment, admin needs to record what each
  store is owed (sum of locked items' `payoutCents`) and what was paid (amount, method e.g. check,
  reference/check #, date, recorded-by admin). Likely a `StorePayout` model; design with user in Phase 4.
  **Platform margin = two parts, both kept** (user, 2026-11-04):
  1. Conversion margin: money in at $1.50/point vs. points spent at $1 retail per point
     (= ledger `earn_*` `cents` − spent `amountCentipoints`, since 1 centipoint = 1 retail cent).
  2. Wholesale margin: item `priceCents` (retail) − `payoutCents` (wholesale paid to store).
  3. Breakage: money behind points wiped at the Jan 1 `season_reset` (collected, never spent)
     **counts as margin** (user, 2026-11-04). Report it as its own line so it stays visible.
  Season total = all money collected − all `payoutCents` paid − refunds/disputes.
- `vercelsetup.md` (user's draft) conflicts with the repo: Node 20.x → **24.x**; Turbo `pipeline` → `tasks`;
  `STRIPE_PUBLISHABLE_KEY` → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; `FCB_` → `FCM_`.
- Product decisions assumed (confirm): fractional points (centipoints); `MAX_TIP_CENTS` $1,000;
  default kid `itemCap` 5; family session 30 days.
