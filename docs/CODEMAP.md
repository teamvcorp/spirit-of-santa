# turboSanta CODEMAP

> Read this before exploring. Keep it current when packages/routes are added.
> Last updated: 2026-11-04. Status: **Phase 1: shared packages + i18n (en/es) done; placeholder pages only.**
> Rules/constants: [../CLAUDE.md](../CLAUDE.md). Roadmap: [../SpiritOfSanta.md](../SpiritOfSanta.md).

## Layout

| Path | What |
|---|---|
| `apps/family` :3000 | Next 16 app. `auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `proxy.ts` (locale), `i18n/`, `messages/`, `app/[locale]/` (layout, placeholder page, not-found, `[...rest]` catch-all) |
| `apps/store` :3001 | Same skeleton |
| `apps/admin` :3002 | Same skeleton (+ `robots: noindex`) |
| `packages/lib` | Client-safe: `season`, `roles`, `limits`, `format`, `locales`, `cookies`. **Server-only:** `constants`, `points` |
| `packages/i18n` | next-intl factories (routing, request, proxy), `Common` messages, `LocaleSwitcher`, `getCommonTranslator` for SMS/push |
| `packages/db` | `connectDb()` + 10 Mongoose models (server-only) |
| `packages/auth` | NextAuth v4 options, guards, argon2id hashing, parent PIN (server-only) |
| `packages/ui` | Turbo starter components (unused so far) |
| `packages/eslint-config` | `./base` (packages), `./next-js` (apps). only-warn + `--max-warnings 0` |
| `packages/typescript-config` | `base`, `nextjs` (apps), `library` (lib/db/auth), `react-library` (ui) |
| `docs/vendor/` | Version-specific notes: `mongoose-9.md`, `next-auth-v4.md`, `next-intl.md` |

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

## Local docs (read before guessing)

- Next.js 16: `node_modules/next/dist/docs/` (breaking changes vs. training data)
- Turborepo: `node_modules/turbo/docs/`
- Our notes: `docs/vendor/*.md`

## Phase 1 status vs. SpiritOfSanta.md (reviewed 2026-11-04)

Done: monorepo, CLAUDE.md, full schema, NextAuth roles, parent PIN, i18n (en/es).

**Accounts:** Atlas ✅ (cluster `santaadmin.10ptpiw`, db `spiritofsanta`, per-app `.env.local`, ping OK).
Stripe test keys ✅ (family + store). **Still blank:** `NEXTAUTH_SECRET` in all three apps
(auth endpoints 500 until set), Stripe webhook secrets, Twilio, Cloudinary, FCM, Vercel, domains.

**Agreed next order (code):**
1. ✅ i18n with **next-intl** (roadmap said next-i18next, Pages Router only; swap still to confirm with user)
2. Shared UI components + sign-in pages per app (replace starter pages)
3. Cloudinary upload helper (store item photos)
4. Seed script + end-to-end login test (needs Atlas)
5. FCM + PWA (Next 16 native manifest + **Serwist**; roadmap's next-pwa is unmaintained)

**No Stripe Connect (user decision 2026-11-04):** stores are paid by check or outside the app.
Stripe only collects money (tips, parent bonuses/pay-ups, donations) into the platform account.
Store payouts will need an admin-recorded payout log (TODO below), not Stripe.

**Stripe webhook endpoint (one; route not built yet):**
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

Check each library against the bundled Next 16 docs before use; save notes in `docs/vendor/`.
Deadline that matters most: **Store MVP live Jan 1, 2027.**

## Open items / TODO

- **No DB integration test yet.** `connectDb()` and auth flows are untested against a real MongoDB.
  Next: Atlas dev cluster → seed script → sign-in test.
- **Security TODO:** Atlas DB user for the apps should have only `find`/`insert` on `transactions`
  (real ledger immutability); per-IP rate limiting on sign-in & tip endpoints (Vercel Firewall/Upstash);
  admin MFA (roadmap); production `syncIndexes` script (autoIndex is off in prod).
- **Account lockout can be abused** to lock out a known email for 15 min. Acceptable now; per-IP limiting mitigates.
- `npm audit`: 10 moderate (minimatch ReDoS) in the ESLint dev toolchain only, not shipped. Not force-fixed.
- Login UI (`pages.signIn`), sign-up/registration, email verification: not built.
- Home pages are placeholders (title + intro + language switcher); real UI is step 2.
- **Store payout log (not designed yet):** with offline payment, admin needs to record what each
  store is owed (sum of locked items' `payoutCents`) and what was paid (amount, method e.g. check,
  reference/check #, date, recorded-by admin). Likely a `StorePayout` model; design with user in Phase 4.
  **Platform margin = two parts, both kept** (user, 2026-11-04):
  1. Conversion margin: money in at $1.50/point vs. points spent at $1 retail per point
     (= ledger `earn_*` `cents` − spent `amountCentipoints`, since 1 centipoint = 1 retail cent).
  2. Wholesale margin: item `priceCents` (retail) − `payoutCents` (wholesale paid to store).
  Per item: money collected for its points − `payoutCents`. Open question: money behind points
  wiped at the Jan 1 `season_reset` (collected, never spent): kept as margin, or tracked separately?
- `vercelsetup.md` (user's draft) conflicts with the repo: Node 20.x → **24.x**; Turbo `pipeline` → `tasks`;
  `STRIPE_PUBLISHABLE_KEY` → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; `FCB_` → `FCM_`.
- Product decisions assumed (confirm): fractional points (centipoints); `MAX_TIP_CENTS` $1,000;
  default kid `itemCap` 5; family session 30 days.
