# turboSanta CODEMAP

> Read this before exploring. Keep it current when packages/routes are added.
> Last updated: 2026-11-05 (Phase 3 slice 2: season controls). Status: **Phase 1: shared packages, i18n, sign-in, image storage, home-screen icons done; placeholder pages otherwise.**
> Rules/constants: [../CLAUDE.md](../CLAUDE.md). Roadmap: [../SpiritOfSanta.md](../SpiritOfSanta.md).

## Layout

| Path | What |
|---|---|
| `apps/family` :3000 | Next 16 app. `auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `proxy.ts` (locale), `i18n/`, `messages/`, `app/[locale]/` (layout, placeholder page, not-found, `[...rest]` catch-all), `app/icon.tsx` + `apple-icon.tsx` + `manifest.ts`, `app/api/webhooks/stripe/route.ts` |
| `apps/store` :3001 | Same skeleton + `/register`, `/verify`, `/accept-invite`, `/accept-rep-invite`; `dashboard/` (overview, `items/` list + `new` + `[id]`, `profile/` details + photos, `reps/`), `dashboard/actions.ts` (owner Server Actions), `api/cron/purge-signups` |
| `apps/admin` :3002 | Same skeleton (+ `robots: noindex`). Dashboard (pending count), `stores/` queue, `stores/[id]` detail + actions, `stores/invite`, `stores/actions.ts` (admin Server Actions) |
| `packages/lib` | Client-safe: `season`, `roles`, `limits`, `format`, `locales`, `cookies`. **Server-only:** `constants`, `points` |
| `packages/i18n` | next-intl factories (routing, request, proxy), `Common` messages, `LocaleSwitcher`, `getCommonTranslator` for SMS/push |
| `packages/db` | `connectDb()`, `withTransaction()` + 12 Mongoose models incl. `Payment` (money records) and `StripeEvent` (webhook log) (server-only) |
| `packages/email` | **Server-only** `sendEmail()` via Resend + pure `renderEmail()` templates (en/es, escaped, link allow-list). Dev prints instead of sending |
| `packages/deeds` | **Server-only** deed catalog (`catalog.ts`) + client-safe zod (`schemas.ts`). Phase 4 deed flow goes here too |
| `packages/stores` | **Server-only** store business logic: `engagement.ts` (`recordItemView` for the family app in Phase 6, `wishListTotals`) + pure `engagement-math.ts`, `admin.ts` (approve/reject/suspend/reinstate/discount/invite/resend/cancel: atomic transitions + AuditLog + owner emails), `owner.ts` (profile, photos, reps; ownership re-checked from the DB on every call), `items.ts` (catalog: window, 50 limit, owner-only pricing, photos), `queries.ts` (queue, detail), `schemas.ts` (discount % → bps), `urls.ts` (STORE_APP_URL) |
| `packages/payments` | **Server-only** Stripe: `client` (`getStripe`, `expectedLivemode`), `metadata` (`sos_*` payment-label contract), `webhook` (verify → dedupe → `handlers`) |
| `packages/auth` | NextAuth v4 options, guards, argon2id hashing, parent PIN (server-only); UI: `SignInSlot`/`SignInForm`, `AccountMenu`, `SignOutButton`; `safeCallbackPath` (open-redirect guard); `scripts/seed-dev.ts`; account flows (`account-flows.ts`: store sign-up, verify, resend, forgot/reset), `tokens.ts` (hashed single-use links), `rate-limit.ts`, `schemas.ts`, shared forms (`forms.tsx`, `token-slot.tsx`, `form-actions.ts`) |
| `packages/ui` | Button, TextField, Card, Alert, SiteHeader, `cn`, `theme.css` (brand tokens, `danger`, focus ring), `app-icon` (icon art + manifest factory) |
| `packages/storage` | **Server-only** `images` (`uploadPublicImage`/`deletePublicImage` on public Vercel Blob, sharp re-encode); client-safe `image-rules` (limits, magic-byte sniff, `blobImagesConfig` for next.config) |
| `packages/eslint-config` | `./base` (packages), `./next-js` (apps). only-warn + `--max-warnings 0` |
| `packages/typescript-config` | `base`, `nextjs` (apps), `library` (lib/db/auth), `react-library` (ui) |
| `docs/vendor/` | Version-specific notes: `totp-mfa.md` (admin MFA + qrcode), `mongoose-9.md`, `next-auth-v4.md`, `next-intl.md`, `vercel-blob.md` (also icons), `stripe.md`, `resend.md` |

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
  **Also fulfilled on the return page (2026-11-06):** registration/tip/donation status pages call
  `fulfilPaidPaymentIntent` (same idempotent handler) when Stripe says the session is paid, so a late or missing
  webhook (always the case locally without the Stripe CLI) doesn't leave kids "awaiting". E2E `stripe-return-fulfil.ts`.
- **Back to where you were after the PIN (2026-11-06, user bug "Record a good deed → parent page"):**
  `requireUnlockedPage(next)` sends a locked parent to `/parent/pin?next=<path>`; the PIN forms carry `next` and the
  actions go there. `safeNext()` (apps/family/lib/parent.ts) is an ALLOW-LIST of family paths (no open redirect).
  Every PIN page passes its own path. E2E deeds 18 (incl. forged next=), bonus 13.
- **Who records deeds (roadmap):** the PARENT picks from the catalog and submits (PIN). No kid-facing "choose a deed
  to do" screen exists (asked user 2026-11-06).
- **Parent PIN lock-state changes = full page load (2026-11-06):** set PIN / unlock return `{ to }` and the form does
  `window.location.replace` (the client router otherwise replayed a cached "/parent → /parent/pin" redirect, so the
  first correct PIN "failed"). Lock = server redirect home. E2E kids test clicks links like a user (20 checks).
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

- **Email:** Resend, sending domain `fyht4.com` (verified). Default from: `Spirit of Santa <no-reply@fyht4.com>`.
- **Payout:** per-store discount % agreed with admin at approval. Store bills Spirit of Santa the agreed wholesale
  cost (retail − discount); we keep the difference. Stored as integer basis points on Store.
- **Pending/invited stores** may set up profile + items immediately; dashboards show a Pending/Invited badge;
  families see a store only once approved.
- **Pricing:** owners set prices; reps add/edit item details + inventory (rep-created items wait for a price).
- **Agreement wording is a DRAFT** (`StoreAgreement` messages, version `2026-11-05`): user must review before launch.
- Slices: 1 accounts+email (DONE, 349c069) · 2 admin approval/invite (DONE, d900b67 + review fixes 44e58aa) · 3 owner dashboard/reps (DONE, ce397ac + 5a9b255) · 4 item catalog (DONE, 4d96799 + b3d07b9) · 5 engagement stats (DONE, 43515e4 + review fixes). Phase 2 buildable scope complete; rep "mark shipped" waits for Phase 6.

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
- **Owner dashboard (slice 3):** owners edit details/photos (pending/approved only; rejected/suspended read-only)
  and manage reps (invite by email → `/accept-rep-invite`; remove = suspend + unlink + sessionVersion++; a removed
  rep can be re-invited and is re-activated). Store pages re-check membership in the DB (`memberStore`), so a
  removed rep loses access immediately even though their JWT lives up to 5 more minutes.
- **Store app emails use its own NEXTAUTH_URL** for links (rep invites). `STORE_APP_URL` is only for the admin
  app (found by the production E2E: production refuses the dev localhost fallback).
- **Store app Server Action body limit = 4.5mb** (`experimental.serverActions.bodySizeLimit`) for photo uploads.
- **Store E2E:** `scripts/e2e/browser-store-dashboard.ts` (dev 21 checks; `--prod` 17 checks, real Blob uploads).
- **Item catalog (slice 4):** items are per store per season (`seasonYear`); statuses `draft` (rep-created, no price) →
  `active` (owner priced) → `archived` (frees a slot). Add/edit/price/archive only while the item window is open
  (`storeItemWindow()`: Season `storeWindow` override, else Jan 1–Mar 31); stock updates any time. 50-item limit is
  checked AFTER insert (counting the new item). Wholesale is shown to owners from the CURRENT discount; it gets fixed
  on the item at funding/lock time (Phase 6, TODO). Prices typed in dollars are parsed to cents with
  `parseDollarsToCents` (no float maths). Engagement columns (views, wish-list adds) show `Item.stats`; funding
  progress per item needs Phase 6 wish lists. Item photos live under `items/<storeId>/`.
- **Testing the item window now:** set `Season.storeWindow` to `"open"` for the current year in the dev DB (the E2E
  does this and restores it). An admin control for it comes with the Phase 3 season settings.
- **Never call a function exported from a `"use client"` file on the server** (e.g. form defaults): keep such helpers
  in a plain module (`item-values.ts`). **E2E selector trap:** `[name="description"]` also matches
  `<meta name="description">`; scope to `main`. Headings in the static shell render before streamed content: wait
  for the content itself.
- **Store E2E (items):** `scripts/e2e/browser-store-items.ts` (27 checks, dev and production; incl. last-season and limit-race checks).
- **Item limit = transaction + lock document (slice 4 review):** add/restore bump `Store.itemLockSeq` inside `withTransaction`,
  then count, then insert. Two transactions writing one document conflict, Mongoose retries the loser, and it re-counts.
  Plain "count then insert" (even in a transaction) is NOT safe: snapshot reads let both see 49. Reuse this pattern for any
  "at most N" rule (e.g. Phase 6 kid item caps).
- **Items are scoped to the CURRENT season** in every read and write (`scopeOf`): older seasons are history, they 404.
- **Editable store statuses:** one list, `EDITABLE_STORE_STATUSES` / `isStoreEditable` in `@repo/lib/store`.
- **Form numbers:** never `z.coerce.number()` for form fields: `Number("")` is 0. Use a digits regex then transform
  (`inventorySchema` in `@repo/stores/schemas`).
- **`autoIndex` is opt-in** (`NODE_ENV === "development"`, i.e. `next dev` only). CLI scripts run with NODE_ENV unset and
  may point at production, so they never auto-build indexes; use `npm run db:sync-indexes`.
- **Item read functions take the loaded store** (`listStoreItems(store, isOwner)`, `getStoreItem(store, isOwner, id)`):
  pass only `loadMember()`'s result for the current request.
- **Engagement (slice 5, user decisions 2026-11-05):** views = item PAGE opened (not list impressions), once per viewer
  per item per day, max 300 counted/viewer/day; viewer = signed-in family id or IP network, stored only as an HMAC
  (NEXTAUTH_SECRET) inside a self-deleting RateLimit key. Wish-list numbers are COMPUTED from WishListItem (no
  counters to drift): on lists / fully funded / locked / funding % (rounded down). Totals only: stores never see kids.
  Season totals only (no daily history yet). Owners and reps both see it. Phase 6 TODO: call `recordItemView(itemId,
  { familyId?, ip: clientIp(headers) })` from the family item page, after deciding to show the item.
- **Aggregations aren't cast or sanitised:** pass ObjectIds from the DB (e.g. `item._id`), never URL strings, and
  never request input. (`sanitizeFilter` only covers find/update filters.)
- **Meter colour:** `bg-meter` token (theme-aware green, validated for both schemes); track `bg-meter/20`.
- **Store E2E (engagement):** `scripts/e2e/browser-store-engagement.ts` (14 checks; `E2E_SCREENSHOTS=<dir>` adds light/dark
  screenshots + 2 checks). Inserts fake WishListItems with known numbers.
- **Windows: stopping `npm run start` / `npx next start` leaves the real `next start` running** (only the wrapper dies).
  For test servers run `node node_modules/next/dist/bin/next start --port <p>` from the app folder, and use a fresh
  port + `NEXTAUTH_URL=http://localhost:<p>` if an old server holds 3001.
- **New env:** store `CRON_SECRET` (Vercel cron auth); admin `STORE_APP_URL` (links in invite/approval emails;
  defaults to http://localhost:3001 in dev, required in production).

## Phase 3 (admin app), agreed 2026-11-05

Order: 1 admin MFA (DONE, 531ebe3 + review fixes) → 2 season controls (DONE, ccd6572 + review fixes) → 3 user management (DONE, a428090 + review fixes) → 4 deed catalog (DONE, 0bcd34f + review fixes) → 5 platform dashboard v1 (DONE, 4c5af67 + review fixes). **Phase 3 buildable scope COMPLETE (2026-11-05).** Deferred until their data exists: content moderation
(Phase 4), donation settings + pay-later links (Phase 5), announcements (Phase 7).

- **Admin MFA (slice 1):** TOTP authenticator + 10 recovery codes (`docs/vendor/totp-mfa.md`). Admin without MFA
  → JWT `mfaSetup` → `requireRole` redirects EVERYTHING to `/mfa/setup`; only that page/action uses
  `requireMfaSetupUser`. Pages that read the session directly (admin home) must check `user.mfaSetup` too.
  Sign-in form shows a code field in the admin app only (`<SignInSlot showCode />`). Blank code = no strike,
  wrong code = strike; a correct-but-used code (double submit) = refused, no strike. 10 wrong codes in a row
  (after a correct password) → 24 h lock + `user.mfa_locked` audit. `admin:create` re-run = lost-phone reset
  (via `resetMfa`, audited). New admin env: `MFA_ENCRYPTION_KEY`. Enabling MFA emails the admin a security
  alert (`mfaEnabled`, no "ignore this" line). Admin tokens carry `mfaV`; tokens without it (pre-MFA) are
  signed out (`ADMIN_TOKEN_VERSION` in options.ts: bump to force all admins to sign in again).
- **`getSessionUser` hides restricted (MFA-setup) sessions** unless `{ includeRestricted: true }` (account menu,
  admin home which redirects). `requireUser`/`requireRole` send them to /mfa/setup.
- **User management (slice 3):** `@repo/auth/admin-users` (list/search, detail + audit history, suspend with
  reason, reinstate, unlock, sign out everywhere, reset another admin's MFA; change + audit in one transaction; never on
  yourself). Pages `/users`, `/users/[id]` (header link). Email search = escaped "starts with" (index-friendly, input is
  never a regex). No delete (COPPA flow, Phase 8); no "activate unverified" (would bypass email verification).
  `suspendedByAdmin` flag distinguishes an ADMIN suspension from a store removing a rep (both set "suspended"):
  only admin suspensions can be reinstated; a store's rep re-invite can't undo one. E2E `browser-admin-users.ts` (15).
- **Ids from requests: always `normalizeObjectId()` (`@repo/lib/ids`)** before comparing as text (upper-case copy of your
  own id once bypassed "not yourself").
- **Dashboard (slice 5):** admin home (`apps/admin/lib/dashboard.ts`): stores/items, accounts by role + pending/suspended,
  deeds, views, items on lists, last 15 audit entries. Add points/money/completed-deed tiles in Phases 4–5.
  E2E `browser-admin-dashboard.ts` (12; tiles compared with its own DB counts). Audit actions have readable labels
  (admin messages `AuditActions`, key = action with "." → "_"): ADD A LABEL whenever you add an audit action.
- **Deed catalog (slice 4):** new package `@repo/deeds` (`catalog.ts` server, `schemas.ts` zod). Admin `/deeds`, `/deeds/new`,
  `/deeds/[id]`: titles en+es required, optional description + suggested tip range (cents, ≤ MAX_TIP_CENTS), ↑/↓ reorder
  (whole list renumbered 10,20,… in one transaction), on/off (no delete: deeds reference their type). "8 suggested
  deeds" only into an EMPTY catalog (`STARTER_DEEDS`, user content to review). Phase 4 reads
  `listDeedTypes({ activeOnly: true })`. E2E `browser-admin-deeds.ts` (16; backs up + restores the catalog).
- **`Lock` model (`@repo/db`: `ensureLock` outside + `takeLock` first inside the transaction)** serializes changes whose rule
  spans many documents (deed catalog). Plain count-then-insert in a transaction is NOT safe (snapshot reads).
- **Season controls (slice 2):** rule book = pure `resolveSeason` / `validateSeasonDates` in `@repo/lib/season`
  (unit-tested); server = `getSeasonState()` in `@repo/stores/season`. ANY server check of season phase or the
  store window must use `getSeasonState()` (it applies the admin overrides). Season dates are stored as calendar
  days `"YYYY-MM-DD"` (Chicago), editable only before that season opens (user decision); store-window switch and
  force-freeze any time. Admin page `/season` (header link). Audit actions `season.*`, targetType `season`.
  E2E `browser-admin-season.ts` (16 checks; restores both Season docs).
- **E2E emails in `next start` are REAL:** any flow that emails (now incl. MFA enable) must use
  `delivered+...@resend.dev` addresses.
- **Admin E2E now uses its own MFA admin** (`createMfaAdmin` in `scripts/e2e/lib.ts`, needs
  `--env-file=apps/admin/.env.local`); `SEED_PASSWORD` no longer needed. `browser-admin-mfa.ts`: 31 checks;
  `browser-admin-stores.ts --prod`: 18 checks. dev-admin@ gets a setup-only session until you set MFA up.
- **npm override:** `@vercel/cli-config` → zod 4.6.7 (its pinned 4.1.11 had a high-severity advisory);
  `npm audit --omit=dev` = 0. Remove the override once @vercel/oidc updates.

## Phase 4 (family app) decisions (user, 2026-11-05)

- Kids: first name + **birth year** only (replace Kid.birthDate). Public pages show only a parent-chosen **display name**
  (default first initial) + family alias if on: never full name, age or town.
- COPPA consent: verified email + consent checkbox (policy version) + **$5 registration fee per kid by card** (Stripe) as
  card-based verification; a kid stays "awaiting registration" (nothing public) until paid. The $5 is PLATFORM
  REVENUE (kid starts at 0 points). Promo code `1kidpayall`: only the FIRST kid is paid, additional kids free (keep the code
  configurable, not in source; audit uses). Lawyer to confirm before launch.
- **Slice 1 parent sign-up (DONE, 0a029c3 + review fixes):** both sign-ups go through ONE `selfSignUp()` routine (limits,
  honeypot, hash-every-path, existing-email handling: pending → fresh link, active → "account exists", other app → nothing).
  Parents get the `verifyParentEmail` template. `registerParent` (same protections as store sign-up) creates a
  pending parent + Family with `consent {version: PARENT_CONSENT_VERSION, acceptedAt}`; verify stamps
  `consent.emailVerifiedAt`. Family app `/register`, `/verify`, `/verify/resend`, DRAFT `/privacy` (needs lawyer review;
  bump `PARENT_CONSENT_VERSION` in `@repo/lib/family` on any wording change). Abandoned parent sign-ups are purged by the
  STORE app daily cron (shared DB). `resendVerificationEmail(app, ...)` now takes the app. E2E `browser-family-signup.ts` (13).
- **Slice 2a kids + PIN (DONE, 27cabe1 + review fixes):** new package `@repo/families` (`kids.ts` service scoped to the parent's own
  family, re-checked in the DB; `schemas.ts`). Kid = firstName (private) + birthYear + displayName (public, default initial)
  + `registration.status` awaiting/registered. Max 10 kids (family lock). Delete = real delete (COPPA). Audit rows never hold
  a child's name. Parent area `/parent` behind PIN (`apps/family/lib/parent.ts` guards; actions re-check the unlock);
  setting/changing the PIN needs the ACCOUNT PASSWORD (`setParentPinWithPassword`). Home `/` = kid selector.
  Deleting a kid also deletes their Deeds + WishListItems (one transaction); ledger/payment rows keep only the id.
  Birth years: under 18 THIS season-zone year (min = year - 18); the current year is always accepted on edit.
  PIN setup: password check honours + feeds the sign-in lockout (`recordFailedLogin` exported); CHANGING a PIN needs
  the unlock. Shared helpers: `LocaleField` (@repo/auth/forms), `formString` (@repo/lib/form). E2E `browser-family-kids.ts` (17).
- **Slice 2b $5 registration (DONE, ad57343 + review fixes):** only a FULFILLED, unrefunded, undisputed card registration
  unlocks the free promo path; webhook registers exactly the still-awaiting kids (first = "card"), fewer than paid for →
  `review`; return page shows registered / processing / review / not paid. Start is rate-limited (10 / 15 min). `@repo/families/registration` (`startRegistration`: SERVER sets the
  amount, $5 × kids or one $5 with `FAMILY_PROMO_CODE` (env, blank = off); promo after an earlier card payment = free,
  immediate, audited `kid.register_promo`). Stripe **Embedded Checkout** (`ui_mode: "embedded_page"`, see
  docs/vendor/stripe.md) on `/parent/register`; return page only SHOWS status. Webhook purpose `registration` (metadata
  `sos_kid_ids`, `sos_promo`) checks the amount and marks the family's awaiting kids registered (card / promo), Payment
  fulfilment `fulfilled`; nothing left to register → `review` (e.g. double payment). Money = platform revenue, no points.
  `@repo/payments/checkout` exports getStripe + buildPaymentMetadata for other packages. No CSP yet: when adding one
  (Phase 8) allow js.stripe.com (script + frame). E2E `browser-family-register.ts` (14).
- **Slice 3 deeds + QR (DONE, a69296f + review fixes):** QR key = own secret `DEED_QR_KEY` (NOT the session secret);
  expiry = min(14 days, season close at Chicago midnight: `startOfDayInZone` in @repo/lib/season); daily cap counts REAL deeds
  since Chicago midnight under a per-kid lock; every usable QR listed + 20 recent; `localized()` helper in @repo/deeds/catalog. `@repo/deeds/deeds` (`recordDeed`: own family, REGISTERED kid, season open|frozen,
  active type, 10/kid/day; `listKidDeeds` with QR images) + `qr.ts`: token = HMAC(HKDF(NEXTAUTH_SECRET,"sos/deed-qr/v1"), deedId),
  DB keeps only SHA-256(token) (`qrTokenHash`), so QRs can be re-shown but not forged from the DB. QR link = `/d/<token>`
  (slice 4 page). 14-day expiry (`expiresAt`), single use (`qrUsedAt`). "Other" text: `customReview: pending` → NOT public until
  an admin approves (moderation queue = next). Kid page `/kids/[id]` (no PIN, shows QRs); record `/kids/[id]/deed` (PIN).
  E2E `browser-family-deeds.ts` (15; needs season open/frozen).
- **Slice 4 QR page + tips + text review (DONE, 70e6828 + review fixes):** tip checkout `expires_at` = min(deed expiry, season
  close, 23.5 h) (Stripe: STRICTLY < 24 h); webhook confirms only a still-PENDING deed (CAS), later tips are credited but
  the first confirmation stands; queue shows only texts that can still go public; public actions use Zod; public `/d/<token>` (`@repo/deeds/public`): display name +
  alias (if on) + deed ("Other" text only if approved); never first/family name. "Say thank you" = atomic single-use confirm
  (no points). Tips (pulled forward from Phase 5): presets $5/$10/$25 or $1–$1,000, Embedded Checkout, metadata purpose `tip`
  → existing webhook credits points + marks deed `paid`; an abandoned checkout does NOT burn the QR. `/d/<token>/thanks` shows
  only what our Payment says. Per-visitor limits (view 120, act 30, tip 10 per 15 min). Admin `/moderation`
  (`@repo/deeds/moderation`): approve/hide "Other" text, audited `deed.text_review`, dashboard count. Pay-later = Phase 5.
  E2E `browser-qr-page.ts` (22; family + admin servers, both env files).
- **Always `connectDb()` before the first query in a service** (public pages can be a fresh instance's first request; a
  missing connect HANGS ~10 s). `hitRateLimit` now connects itself.
- **E2E gotcha:** visiting `/es/...` sets a locale cookie; later prefix-less visits in the same browser context are Spanish.
- **Slice 5 parent controls (DONE, b1f6ebe + review fixes):** `KidVote` (one per kid per Chicago day, upsert = change same day;
  unvoted days = Nice, computed). **Voting runs ALL YEAR; Santa's list year = Dec 26 → Dec 25** (`santaListYear` in
  @repo/lib/season: votes from Dec 26 count toward NEXT Christmas; user decision 2026-11-06). Nice days count from the list
  start or the kid's REGISTRATION date. Votes audited (`kid.vote`), registered kids only, deleted with the kid.
  Family nickname needs ADMIN APPROVAL (`aliasReview`, admin /moderation "Family nicknames") before it shows publicly.
  `@repo/families/votes` (castVote, familyTallies), `settings.ts` (family nickname + on/off, audited without text). Kid form
  has `itemCap` (0–50, enforced in Phase 6). Dashboard: tally + Nice/Naughty buttons (aria-pressed) + nickname card;
  kid page shows the tally. E2E `browser-family-controls.ts` (13).
- **Slice 6 donation QR (DONE):** each REGISTERED kid has a shareable link `/k/<token>` (+ QR on the kid page) for family
  friends to give with NO deed. Token = HMAC(DEED_QR_KEY, "donate|kidId|version"); only its SHA-256 on the Kid
  (`donationTokenHash`, select:false, sparse unique). "Make a new link" (PIN unlock needed) bumps `donationLinkVersion` →
  old link dies at once; audited `kid.donation_link_reset`. Public page: display name + APPROVED nickname only. Money =
  Stripe Embedded Checkout, purpose `tip` WITHOUT `sos_deed_id` (existing webhook credits points); expires at
  min(season close, 23.5 h). `@repo/deeds/donate`; per-visitor limit `donate` 10/15 min. E2E `browser-family-donate.ts` (15).
  Review fixes: lazy hash write is compare-and-set on the version (a reset can't be undone by a page render); the OLD
  link's thanks page still recognises a checkout started before the reset (`wasKidsLink`, constant-time over versions);
  checkouts already open from an old link CAN still finish (money goes to the same kid; UI says so). Shared
  `publicFamilyAlias` / `publicSeason` (public.ts) and `qrDataUrl` (qr.ts) = one privacy rule + one QR look.
  **Deferred to Phase 5:** merge startTip/startDonation + tipStatus/donationStatus into one kid-checkout helper (pay-later
  reworks that code anyway); kid page computes the donation link + QR on every render (fine at current scale).
- **Amount pickers (tip /d + donate /k) = shared `apps/family/components/amount-picker.tsx`.** React 19 RESETS a form
  after its action runs; a controlled "which radio" state then drifts from the DOM (empty required "Other" box silently
  blocked the next submit). Fix pattern (same as the deed form): action echoes `values` + `nonce`
  (`apps/family/lib/amount-form.ts`), `<form key={nonce}>`, radios use `defaultChecked`. **Use this for any radio/
  conditional-field form driven by useActionState.**
- **Server Actions can't read the locale** (`getLocale()` / next/root-params throw there): forms send a hidden `locale`
  field and actions redirect with `localizePath()`.
- Order: 1 parent sign-up → 2 kids + PIN + dashboard shell (+ $5 step) → 3 deed + QR → 4 QR landing/thank-you →
  5 parent controls → 6 donation QR. Pay now/later (Stripe Elements, Twilio) = Phase 5.

## Phase 5 (payments) decisions (user, 2026-11-06)

- **/donate (slice 2):** community/corporate gifts to "all kids" or one zip POOL and are split ONCE on Dec 1, in EQUAL
  shares among eligible (registered) kids. Admin-set platform fee % taken off the top at the split (platform revenue),
  stated plainly on the page. Tax receipt email for EVERY gift via Edynsgate (501(c)(3); legal name + EIN in admin).
- Order: 1 parent bonus → 2 /donate → 3 Jan 1 reset → 4 pay-later SMS (needs Twilio A2P approval). Dec 25 pay-up and
  store payouts/profit tracking moved to Phase 6 (need wish lists + fulfilment).
- **Slice 1 parent bonus (DONE):** `/parent/bonus` (PIN unlock; `?kid=` preselects; dashboard link per REGISTERED kid).
  `@repo/families/bonus` (startBonus, bonusStatus, bonusWindow): own registered kid only, amount via tipAmountCents
  (re-checked by webhook), season open/frozen only (a bonus after Dec 25 would be wiped Jan 1), checkout expires at
  min(season close, 23.5 h), 10 starts/15 min per parent, Stripe sees no child name. Webhook already credits `bonus`
  (ledger `earn_bonus`). Return page fulfils too. `MIN/MAX_CHECKOUT_MS` moved to @repo/lib/limits (families cannot
  import deeds: deeds depends on families). E2E `browser-family-bonus.ts` (12).
  Review fixes: ONE "gifts accepted now?" rule = `giftWindow()` in @repo/stores/season (tips, donations, bonus);
  ONE "back from Stripe" helper = `checkoutReturnStatus(sessionId, belongs)` + `creditReturnState` in
  @repo/payments (registration/tip/donation/bonus status all use it; `belongs` checks Stripe's own metadata).
  Return pages need only the signed-in parent, NOT the PIN unlock (15 min, SameSite=strict: the redirect back from
  Stripe can arrive locked). startBonus bounds-checks the amount itself; rate limit counted before any lookup.
  Webhook credits tips/bonuses only to REGISTERED kids (else review). Tips, donation links and bonuses deliberately
  share one set of amount limits (TIP_PRESETS/MIN/MAX_TIP_CENTS).
- **Slice 2a community donations (DONE, split = 2b):** public `/donate` (+ `/donate/thanks`, header "Donate" link):
  "all children" or one ZIP, presets $25/$50/$100/$250, $5–$50,000 (`DONATION_*` in @repo/lib/limits; webhook
  re-checks). Open only while the season is OPEN (before the freeze, when pools split) AND an admin has set the fee
  (the fee must be stated before anyone gives). Checkout expires by the freeze. Payment = purpose `donation`,
  fulfilment `held`, `zip` on the Payment. Page shows the season total only (no per-ZIP numbers: privacy). ZIP with no
  registered kids at split time → goes to all kids (stated on the page; implement in 2b).
  `@repo/payments/community` (startCommunityDonation, communityDonationStatus, donationWindow, seasonDonationTotal),
  `/settings` (admin; `PlatformSettings` singleton: donationFeeBps NO default, charity legalName/EIN/address,
  `receiptsEnabled` OFF by default, audited `settings.update`), `/receipts` (`DonationReceipt`, one per
  PaymentIntent; donor email/name from Stripe Checkout `customer_details`; locale from `sos_locale`). Webhook creates
  + sends the receipt AFTER the money transaction, best-effort. Receipts only go out when switched on + name + EIN
  (a 501(c)(3) receipt is only valid if the charity receives the gift: user must confirm with Edynsgate/accountant);
  saving settings sends waiting ones; claim = CAS on `attempts` + Resend idempotency key `receipt/<no>`.
  Email renderer: body `white-space:pre-line` (multi-line receipt). E2E `browser-community-donate.ts` (26; saves and
  RESTORES PlatformSettings).
  Review fixes: receipts only for POOLED gifts (fulfilment held/credited, never review); admin sets **"Receipts cover
  gifts from"** day (`receiptsFromDay`: when the charity arrangement took effect) and ONLY gifts on/after it are ever
  sent (earlier ones counted as "made before"); charity details stored on the receipt when sent (`issuer`);
  receipt date = `Payment.succeededAt` (new); receipt no. = sha256(full PI id) (no case-folding collisions, collision
  logged); Save sends at most 10, the rest on the cron (2b); fee % formatted in the page language; settings rules
  live ONLY in `settingsInputSchema` (specific error codes). E2E 29.
- **Slice 2b the split (DONE):** `@repo/payments/split`: `planSplit`/`shareOf` are PURE (unit tests
  `packages/payments/test/split.test.ts`); `runDonationSplit` = season frozen/closed + fee set → Lock "donation-split" →
  ONE transaction: `DonationSplit` record + `earn_donation` ledger rows (idempotencyKey per run/pool/kid) + Kid `$inc`
  + Payments held→credited with `splitId` (CAS on held). Fee = floor(cents × bps / 10000); points = server constant;
  rounding leftover + a pool < 1 centipoint each stays (tooSmall = stays held). Empty ZIP → "all kids" (fee once).
  Eligible = registered, not archived; ZIP pool = family ZIP. Cron (now `apps/family/app/api/cron/money`) daily 08:00 UTC
  (split + send pending receipts, independent; Bearer CRON_SECRET) → late gifts shared next day. Admin `/donations`:
  preview table, "Split now" (tick required, audited `donations.split`), past runs, receipt counts + retry failed.
  Scale note: one transaction credits every kid; fine for thousands; batch it if kids reach tens of thousands.
  E2E `browser-donation-split.ts` (19): test-only ZIPs, REFUSES if the dev DB already has held gifts, restores
  season + settings.
  Review fixes: split ONLY while FROZEN (Dec 1-25; points after the close are wiped Jan 1, like bonuses) → **slice 3
  (Jan 1 job) must settle gifts still held after the close as retained/platform, visibly**; refunded/disputed/
  needsReview gifts never shared; plan+settle = one short tx (fee/phase read AFTER the lock), kids credited in
  BATCHES of 500 per tx, `DonationSplit.status` crediting→done + stored `recipients`, interrupted runs resumed first
  (`resumed` in the result); no parallel ops on one tx session; preview shows "—" with no fee; cron maxDuration 300.
- **Slice 3 season end (DONE):** `@repo/payments/season-end` `runSeasonReset(now?)`: only in the OFF-SEASON (Jan 1 →
  next open), once per ended season (`SeasonReset`, unique seasonYear, running→done, resumable). (1) held donation
  gifts of that season → fulfilment `retained` (platform), totals recorded; (2) every kid with points → `season_reset`
  ledger row (= balance) + balance 0, 500 per tx, CAS on the balance. Escrow left to Phase 6. Runs inside the daily
  money cron `/api/cron/donations` (split + season end + receipts; Hobby = 2 crons). Admin /donations "Season end" card.
  E2E `season-reset.ts` (11; injects Jan 2 as `now`; SAVES + RESTORES every other kid's balance; refuses off-season).
  Review fixes: cron runs split → season end → receipts IN ORDER (split finishes interrupted runs first) and the reset
  REFUSES while any DonationSplit is "crediting"; ONE rule `cleanHeldDonations()` (split.ts) for what may be shared or
  retained (refunded/disputed/flagged stay held, never counted); batches re-read balances ON the session + bulkWrite
  CAS (conflict → whole batch retried); ledger key per (season, kid); "done" set inside the lock only when no kid has
  points; "retained" = received on /donate/thanks and still gets a receipt.
- **Slice 4a carrier pages (DONE):** public `/text-messages` (+/es), `/terms` (DRAFT, `TERMS_VERSION`), `/privacy`
  + "visitors" & "texts" sections (PARENT_CONSENT_VERSION → 2026-11-06-draft), footer on every family page linking all
  three. These URLs are REGISTERED with the carriers (Toll-Free Verification): keep them public. The opt-in form =
  `apps/family/components/pay-later-form.tsx` (`PayLaterFields`, `PayLaterConsentText`, `PayLaterPreview`); the
  registered sentence lives ONLY in messages `PayLater.consent` (version `SMS_CONSENT_VERSION`); "7 days" must equal
  `PAY_LATER_LINK_DAYS`. E2E `browser-text-pages.ts` (14) compares the page to the registered sentence.
  Review fixes: wording pinned by `SMS_CONSENT_SHA256` (en+es) + "N days" = PAY_LATER_LINK_DAYS, checked by the i18n
  test; /privacy titled "Privacy Policy and Children's Privacy Notice", own `PRIVACY_VERSION` (parents' consent
  version unchanged, both shown); names Twilio + visitor retention; Terms rate from CENTS_PER_POINT, refunds "except
  where law/card network requires"; shared `components/legal-sections.tsx` for the three legal pages. Spanish consent
  must also be told to the carriers (docs/vendor/twilio.md).
- **Slice 4b pay-later texts (DONE):** deed page /d/<token> "Pay later by text" (`d/[token]/pay-later-section.tsx`,
  `payLaterAction`) → `@repo/deeds/pay-later` `startPayLater`: consent (unticked box, re-checked) + tip amount + US number
  (`toUsE164` @repo/lib/phone) + `tipTarget` (THE "deed can take money now" rule, shared with startTip) → limits (one
  per deed = unique deedId; 3 per number per day via HMAC `phoneKey`; 5/15 min per visitor) → `PayLaterRequest`
  (consent record: number, time, SMS_CONSENT_VERSION, locale; TTL 13 months) → single-use Stripe Payment Link
  (price_data inline, `restrictions.completed_sessions.limit 1`, NO submit_type so the URL is buy.stripe.com = the
  registered sample) → ONE text (`payLaterText`, registered wording, English, "expires in N days" rounded DOWN). Text
  fails → link switched off. Webhook `onCheckoutSessionPaid` switches the link off + request "paid"; daily cron
  `expirePayLaterLinks`. `@repo/sms` (new): `sendSms` via Twilio REST (fetch), API key or Account SID + Auth Token,
  Messaging Service or From; PRINTS in dev unless TWILIO_DEV_SEND=true; `smsFailureFor` (21610 STOP → optedOut).
  E2E `browser-family-paylater.ts` (16). Review fixes: ONE ACTIVE request per deed (partial unique index
  `deedId_active_unique` on `active: true`; failed/expired/closed free the deed); per-number limit (3/24 h, failed
  don't count) checked under a per-number Lock; status "sending" before the text (if recording "sent" fails it still
  counts as sent); link expires ≥ 1 day BEFORE the deed/season deadline (`payLaterExpiry`, unit-tested) and needs
  ≥ 1 full day; cron runs expiry BEFORE the season end, each link on its own; a deed thanked or paid another way
  closes its link (`closePayLaterForDeed` in @repo/payments/pay-later-links, called by the webhook + thankDeed);
  the deed page looks it up only for open deeds by id (`PublicDeed.deedId`, server-side only).
  **Prod: run `npm run db:sync-indexes` after deploy** (drops the old unique `deedId_1`, adds the partial one).
- **Daily money cron MOVED to the FAMILY app (2026-11-06):** `apps/family/app/api/cron/money` (+ `apps/family/vercel.json`
  08:00 UTC): split → season end → pay-later expiry → receipts. The store keeps only purge-signups (no Stripe key there;
  don't spread money secrets). CRON_SECRET needed in BOTH family and store projects.
- **Alert roles:** `tone="error"` → `role="alert"`, info → `role="status"`. E2E success checks must match both.
- **Dev server gotchas:** new message namespaces may need a dev-server restart. **Mongoose models are cached across
  hot reloads (`models.X ?? model(...)`): after a SCHEMA change restart the dev server, or new fields are silently
  dropped (strict mode).** `TaskStop` on `npm run dev` leaves the
  `next dev` children running (ports stay taken): stop them by PID (Get-NetTCPConnection on 3000–3002).
- **Stripe CLI forwarder + E2E:** with `stripe listen` running, `stripe-webhook.ts --real-stripe` SKIPS the
  "refund before payment" check (the CLI records the real payment first). Stop the forwarder to run that check.
- **E2E gotcha (Next 16 Cache Components):** after a client navigation the PREVIOUS page stays in the DOM, hidden
  (instant back). Two `<main>`s exist: scope locators to `main:visible` and filter "is it hydrated" checks with
  `checkVisibility()`, or a check can pass on the hidden page.

## Phase 6 (wish lists + fulfilment) decisions (user, 2026-11-06)

- New points fill the kid's OLDEST unfunded item first; kid ADDS (no PIN, item cap), parent REMOVES (PIN); store stock
  reserved at FULL FUNDING (none left → `needsSubstitute`); item share links = the kid's donation link. Slices: 1 engine
  → 2 browser + list UI → 3 fulfilment → 4 Dec 25 unfunded + pay-up, Jan 1 escrow → 5 store payouts + profit.
- **Slice 1 points engine (DONE):** new `@repo/wishlists` (deps: auth, db, lib, stores; NOT payments: payments imports
  it). `plan.ts` `planAllocation` PURE (tests). `engine.ts`: `allocateForKid(kidId, session)` (oldest first, CAS on
  item funded + kid available, ledger `escrow` rows, full funding → `fully_funded` + `fullyFundedAt` + reserve 1 unit
  or `needsSubstitute`), `addToList` (season OPEN, registered kid of own family, active item of an APPROVED store this
  season, in stock, not listed, under itemCap, ≥ 1 available point), `removeFromList` (caller checks PIN; only
  active/fully_funded while OPEN; ledger `release`; reserved unit back; released points re-allocated),
  `lockFundedItems` (30 days (superseded 2026-11-07: see "Year-round slices 3+4" below)), `sweepAllocations` (safety net). Concurrency: every change writes the Kid doc inside a
  transaction → MongoDB write conflict → retry. Hooks: webhook tip/bonus credit calls `allocateForKid` in the same tx;
  donation split ends with `sweepAllocations`; daily money cron: lock + sweep. NOTE roadmap rule: with eager oldest-first
  allocation, a kid can only add another item once they have spare (available) points.
  `ownFamilyId`/`Parent` live ONLY in `@repo/auth/family-owner` (import from there). E2E `wishlist-engine.ts` (18).
  Review fixes: points move ONLY while the season is open or frozen and ONLY onto THIS season's items (`fundingSeason`):
  after Dec 25 nothing moves (available is zeroed Jan 1; last season's items never absorb new points); removal checks
  the 30-day lock by DATE (superseded 2026-11-07: see "Year-round slices 3+4" below); add/remove re-check the season before commit (freeze mid-request
  → rolled back, "seasonNotOpen"); sweep starts from kids WITH points; split's sweep is best-effort;
  `MIN_CENTIPOINTS_TO_ADD_ITEM` in @repo/lib/limits. **Before live use, slice 4 MUST handle escrow still on unfinished
  items at Dec 25 (→ unfunded, parent pay-up, then zeroed with the Jan 1 reset).**
  User 2026-11-06: an item not fully funded at Dec 25 DROPS OFF and its escrowed points go to Spirit of Santa
  (confirm a parent pay-up window first, at slice 4). The "≥1 spare point to add" rule stays (big lists = active kids).
- **Slice 2 gift browser + wish-list UI (2026-11-06).** Kid pages (NO PIN, parent session):
  `/kids/[id]/gifts` (GET form: q / category / sort / page in the URL, `parseGiftQuery` = Zod with
  defaults on bad input; 24 per page), `/kids/[id]/gifts/[itemId]` (photo, store, points price, stock, Add button
  with the reason it's blocked; counts a store view via `recordItemView`), "My wish list" card on `/kids/[id]`
  (`wish-list-card.tsx`, native <progress>, lock date, substitute note). Parent PIN page
  `/kids/[id]/wishlist/[wid]/remove` (added to `safeNext`). Share = the existing donation link (hint text).
  Reads: `@repo/wishlists/catalog` (`browseGifts`/`giftDetail`/`kidWishList`; aggregation with $lookup of
  APPROVED stores; $text search on the Item text index = whole words). Pure rules `@repo/wishlists/rules`
  (`CAP_STATUSES`/`countsTowardCap` ≠ the store dashboard's ON_LIST_STATUSES, `lockAt`, `isRemovable`) shared by engine + UI (tests). Review fixes: one error vocabulary (UI uses engine codes, e.g. `alreadyListed`), view counted in `after()`, browse queries in parallel, page past the end → last page, rows of hidden gifts not linked (`viewable`), remove redirects to the engine's kid id. `toObjectId` in @repo/db: aggregate() does
  NOT cast string ids (a string $match silently matches nothing). E2E `browser-family-wishlist.ts` (23).
  Gotcha: notFound() inside Suspense streams with HTTP 200: E2E checks the "Page not found" text, not the status.
- **Slice 3a fulfilment: stores (2026-11-06).** User decisions: store told to SET ASIDE at full funding, ships only at
  LOCK-IN (superseded 2026-11-07: see "Year-round slices 3+4" below) (30 days or the freeze, whichever first; `lockFundedItems` locks ALL this season's fully funded gifts once
  frozen/closed); family emailed only when the admin sends it on (3b). `@repo/wishlists/fulfilment`: `storeOrders`
  (set aside / ready / out of stock / shipped 60 days), `markShipped` (own store, LOCKED, no substitute pending,
  compare-and-set, audit "wish.ship"), `sendStoreDigests` (daily, from /api/cron/money after locking: one email per
  store member = owner + active reps, template `storeOrders`, lines "2 × Bike (refs AB12CD, …)", waits until the
  admin saves Settings → shipping address; marks setAsideNotifiedAt/readyNotifiedAt only AFTER sending; idempotency
  key = hash of the gift ids), `orderRef` (last 6 hex). Stores NEVER see anything about the child. Store app
  `/dashboard/orders` + overview alert; admin Settings "shipping address" (PlatformSettings.shippingAddress, read by
  fulfilment directly: payments imports wishlists, so no cycle). New WishListItem fields: set-aside/ready notified,
  substitute arranged/note, shippedBy/trackingNote, receivedAt/By, deliveredBy, familyNotifiedAt. Family project now
  needs `STORE_APP_URL`. E2E `browser-store-orders.ts` (18).
  Review fixes: lock-at-freeze uses the freeze DATE, never the reversible admin force-freeze switch; digest = THIS
  season only, key = hash of ids+statuses+address, stamped once ≥1 member got it (bad rep address ≠ daily repeats),
  600 ms between sends (Resend 2/s), 150 s budget (rest "deferred" to next run), store with no active member = failed;
  cron reports digest failures as a partial failure (500 + log). Overview uses cheap `orderCounts(storeId)`; open
  orders and shipped history capped separately. `DAY_MS` single source in `@repo/lib/time`.
- **Slice 3b fulfilment: admin + family (2026-11-06).** Admin `/fulfilment` (nav "Fulfilment"): needs a substitute
  (`arrangeSubstitute`: note 3–300, clears the flag + notified stamps so the store is told again) → in transit
  (`markReceived`) → to send (shows child first name, family, parent email: admins deliver) → `markSentToFamily`
  (status delivered, then the parent's `giftOnItsWay` email in their language, link to the kid page;
  familyNotifiedAt). All compare-and-set + audited ("wish.substitute/receive/deliver"; targetType wish_list_item).
  Failed parent emails retried by `sendFamilyNotices` in /api/cron/money (14 days). `familyAppOrigin()`
  (FAMILY_APP_URL, admin + family projects) next to `storeAppOrigin()` in @repo/stores/urls. Family labels: shipped
  = "Being prepared", delivered = "On its way!" (user: family hears only when Spirit of Santa sends it).
  No family delivery address is stored (privacy): admin arranges delivery with the parent by email (open question).
  E2E `browser-admin-fulfilment.ts` (16). Review fixes: parent emails batched (bulk lookups), paced (600 ms) with a
  60 s budget; familyNotifiedAt ONLY when an email really went out; child/family deleted → familyNoticeSkippedAt;
  inactive parent = failed (retried); cron alerts on failed notices; admin lists show REAL totals (oldest 300 shown,
  "showing the oldest N of M"); parent-email state emailed/pending/failed(after 14 days: contact them)/none.
- **Slice 4a pay-up window + Dec 25 close (2026-11-06).** User: from the freeze DATE until
  `PAY_UP_CLOSES_DAYS_BEFORE_CLOSE` (7) days before the close a parent pays the MISSING amount of a gift
  (`payUpCents`: missing centipoints at $1.50 rounded up, ≥ `MIN_STRIPE_CHARGE_CENTS` 50). `@repo/wishlists/payup`
  (`payUpWindow`, `payUpOptions`, `closeUnfunded`); checkout `@repo/families/payup` (`startPayUp`/`payUpStatus`, like
  bonus; wishlists can't import payments). Webhook "payup": gift must be that kid's (else review), ledger
  `earn_payup`, `allocateForKid(kid, session, now, firstId)` fills the PAID-FOR gift first (stable sort), surplus as
  usual. Parent `/parent/payup` (PIN, in safeNext) + `/return`; dashboard alert while gifts are unfinished.
  Dec 25: `closeUnfunded` (money cron, wishLists step, BEFORE the Jan 1 reset): every "active" gift of a closed
  season → "unfunded", ledger `forfeit` (idempotencyKey forfeit:<id>), kid escrow −funded (compare-and-set ≥;
  refuses + alerts if escrow is out of sync). Cron alerts when any close fails. E2E `browser-family-payup.ts` (19).
  Review fixes: pay-up Checkout EXCLUDES delayed methods (bank debits/vouchers: v23 has no payment_method_types);
  webhook credits a pay-up for a gift no longer "active" (or another season) but sets needsReview; a gift that fails
  to close is PARKED (closeNeedsAttentionAt, counted as needsAttention, skipped after) so one bad record can't fail
  the job daily; texts show the REAL close date ({close}); dashboard uses `payUpCount`; window checked before the
  rate limit (20/15 min); cron log names digest/notices/close failures.
- **Slice 4b delivery address (2026-11-06).** User chose to COLLECT it. `@repo/auth/sealed` = the ONE AES-256-GCM helper
  (seal/unseal/sealJson/unsealJson, per-purpose keys MFA_ENCRYPTION_KEY / ADDRESS_ENCRYPTION_KEY, AAD = owner id; MFA
  now uses it, same "v1.iv.tag.ct" format). Shape + Zod in `@repo/lib/address` (US_STATES, deliveryAddressSchema,
  addressLines). Family.deliveryAddressEnc (select: false) + deliveryAddressUpdatedAt. `@repo/families/address`
  (addressState/saveAddress/deleteAddress): accepted ONLY while a gift is AWAITING_DELIVERY (rules.ts: fully_funded/
  locked/shipped); audited without content. Parent `/parent/address` (PIN, safeNext) + dashboard prompt. Admin
  Fulfilment "To send" shows label lines (`adminFulfilment(adminId)` audits "family.address_view" per family);
  `markSentToFamily` deletes it when nothing else is on its way; `purgeUnneededAddresses` in the money cron.
  Privacy page "collect"/"keep" mention it (lawyer review). E2E `browser-family-address.ts` (20).
  Review fixes: `@repo/wishlists/delivery` = the ONE place (ADDRESS_KEY, familyAwaitingDelivery, clearAddress =
  compare-and-set on deliveryAddressUpdatedAt + audit, purgeUnneededAddresses = distinct + $nin, audited with NO actor
  = system; AuditLog.actorUserId now optional); unsealJson throws on a MISSING/malformed key (config error ≠ unreadable);
  admin view audit once per admin+family+day (RateLimit key address-view-audit:...); address text also refuses p{Cf}
  (bidi overrides, zero-width); line2 of spaces = blank; one AddressPanel for save+delete feedback; dashboard uses
  `addressMissing` (presence only, no decrypt).
- **Slice 5 store payouts + money summary (2026-11-06).** Roadmap: paid OUTSIDE the app (check/transfer), recorded
  by admin. Owed once Spirit of Santa RECEIVES a gift: `markReceived` fixes `payoutOwedCents` =
  `owedForGift` (payout-amount.ts → `wholesaleCents(cost, store discount)`, the ONE formula); null when the store
  has no discount (filled in later by `fillMissingAmounts`). `StorePayout` model (amount computed, never typed;
  method/reference/paidOn/note; gifts link via WishListItem.payoutId). `@repo/wishlists/payouts`: `owedByStore`,
  `recordPayout` (ALL owed gifts of the store in one tx, compare-and-set payoutId; refused while any amount is
  missing; audited "payout.record"), `listPayouts`, `storePayoutView` (storeId from memberStore), `seasonMoney`
  (collected by purpose − refunds/lost disputes − wholesale for received gifts = net; wholesale margin; breakage =
  season_reset + forfeit points at $1.50; Stripe fees NOT included). Admin `/payouts` (?year=, confirm box with the
  exact amount; action refuses if the amount changed since the page loaded; success = redirect ?paid=<id> because
  the store's row disappears). Store Orders page: "Payments from Spirit of Santa". E2E `browser-admin-payouts.ts` (19).
  Review fixes: confirmed amount (seenCents) compared INSIDE the payout transaction; concurrent payout → "changed"
  (PayoutChanged, not a 500); action input via Zod; amount owed fixed INSIDE the receive transaction (adminStep accepts
  a set-factory run with the session); fillMissingAmounts = distinct stores WITH a discount + bulkWrite (no N+1, no
  starvation); seasonMoney leaves unpriced gifts OUT (withoutAmount, page warns); payout seasonYears[]; store Payments
  card is OWNER-only (wholesale reveals the discount), shows pendingCount.
  **PHASE 6 COMPLETE (2026-11-06).**

## Phase 7 (notifications): EMAIL only, parents only (user 2026-11-06; no web push/SMS)

- **Slice 7.1 foundations (2026-11-06).** `@repo/email`: `sendEmailBatch` (Resend batch, 100/request, idempotency key
  per chunk, failed chunks reported) + `optOutLinks` on any send (footer "Stop emails like this" + "Choose which emails
  you get", and List-Unsubscribe + List-Unsubscribe-Post one-click headers: Gmail/Yahoo bulk-sender rules).
  `@repo/families/notifications`: kinds magic/deeds/reminders (Family.notify.*, missing = ON), get/setNotifyPrefs
  (audited "family.notify_prefs"), signed unsubscribe tokens "<fid>.<kind>.<HMAC>" (HKDF label sos/unsubscribe/v1
  from NEXTAUTH_SECRET; constant-time verify; only ever switches ONE kind OFF; no expiry), `optOutLinksFor`.
  Pages: `/parent/notifications` (PIN, "Email settings" on the dashboard), public `/unsubscribe?t=` (opening it
  changes nothing; button confirms), `POST /api/unsubscribe?t=` (RFC 8058 one-click; GET 405). E2E
  `browser-family-notify.ts` (11). Review fixes: batch chunk idempotency key = hash of exactly what it sends; an
  email that can't be built fails alone; missing RESEND_API_KEY throws (loud); token must be exactly 3 parts (Zod at
  the route/action); unsubscribe change+audit in one transaction; settings form echoes choices on error; NOTIFY_KINDS
  in `@repo/lib/notify` (client-safe, one list); ONE key-derivation helper `@repo/auth/purpose-key` (unlock cookie,
  item views, unsubscribe, MFA recovery: byte-identical keys).
- **Slice 7.2 digests + reminders (2026-11-06).** `@repo/families/digest` (money cron, after the address purge):
  `sendFamilyDigests` = one daily summary per family (template familyDigest, lines via `digestLines`): points from
  OTHERS only (earn_tip, earn_donation; never the parent's own bonus/pay-up) + deeds thanked, only news newer than
  notify.lastDigestAt (set to the NEWEST item included, not the run time), 7-day look-back, respects magic/deeds
  prefs, active parents only. Unsubscribe scope "digest" (= magic + deeds off: one email carries both).
  `sendSeasonReminders`: cutoffReminder 3 days before the freeze DATE (families with a registered kid) and
  payUpReminder 3 days before the pay-up deadline (families with an unfinished gift); once per season
  (notify.cutoffSentYear / payUpSentYear). All via `sendEmailBatch`; cron alerts on failed sends; cron logs the full
  stack of a failed job in DEVELOPMENT only (production: error type). E2E `family-digest.ts` (13).
  Review fixes: digest reports news up to now − 10 min (SETTLE_MS: a write still committing can't slip behind the
  marker), reads in time order, a capped read moves the boundary back (rest tomorrow), lastDigestAt = that boundary
  (one bulkWrite); grouped once by family/kid; pay-up reminder targets only gifts of REGISTERED, non-archived kids
  (= /parent/payup) and shows `lastPayDay` (closesAt − 1 ms: "until Dec 17", also on the pay-up page); reminders
  page through all families (no cap); indexes Transaction{type,createdAt}, Deed{status,confirmedAt} (db:sync-indexes);
  `intlLocale` + `formatLongDate` (one mapping/formatter, replaced 4 copies); digest scope label under Notify.scopes;
  point plurals ("1 point") via the number in ICU. E2E family-digest (16). **PHASE 7 COMPLETE.**
  Unexplained once: the digest step failed inside the dev server on its first run after this change (not reproduced
  in 4 runs since): watch the dev log line "[cron] job failed".

## Phase 8.5 (UI & visual design): "Winter Night" (approved mockup https://claude.ai/artifact/UKrawvum5xqo31C2A3DnvV)

- **8.5.1 foundations (2026-11-06).** `packages/ui/src/theme.css` = the ONE place for colours/fonts/base styles
  (apps' globals.css only import it). ROLE tokens that swap with light (snowy day) / dark (starry night):
  background/foreground/surface/muted/primary(+hover,on-)/accent(on-,-text)/danger/input/meter/focus; fixed night,
  night-deep, snow, gold, gold-light, berry. Contrast table in the file (all AA). Gold is a BACKGROUND only.
  h1–h3 use font-display (Fraunces) via a base rule; body Nunito Sans. Fonts loaded ONCE in `@repo/ui/fonts`
  (next/font, self-hosted at build; works from the shared package) → `fontVariables` on <html> in each layout.
  `buttonClass(variant, extra)` in @repo/ui/button = the ONE button look (links too); variants primary/secondary/
  ghost/festive(berry). `Logo`/`LogoMark` in @repo/ui/logo = PLACEHOLDER (swap the SVG there for the real logo).
  SiteHeader = night bar in both modes; it RE-SCOPES --foreground/--muted/--focus so anything placed in it stays
  readable. No more brand-red/green classes anywhere. Test fixes: browser-store-dashboard reads main:visible and
  waits for the re-rendered invite list (it failed before 8.5 too: a race, not the app).
  Review fixes: ROLE tokens are `@theme inline` (read where used) so a scope works; SiteHeader re-scopes the FULL
  night palette (primary/surface/input/accent-text/danger too); fixed palette is `@theme static` (always emitted: the
  logo reads var(--color-gold/night)); Button/buttonClass have a SIZE (sm/md/lg/inline) owning height+padding, extra
  classes are layout-only; `shadow-card` token (mode-aware); app icons Winter Night (hexes must match theme.css).
- **8.5.2 family app (2026-11-06).** Bottom tab bar (`components/tab-bar.tsx` client + `family-tabs.tsx` server:
  signed-in PARENT only, never on visitor pages; Wish list/Gifts follow the open child via the path). Home: hero
  gradient (day/night by device) + `Snowfall` (CSS-only, HOME only) + `<picture>` day/night art; kid cards. Kid page:
  night band (`NIGHT_SCOPE` exported from @repo/ui/site-header) with the points pill; `MagicBar` (role=progressbar,
  gold while collecting, green when done, fill + shine); `Celebration` ("Fully funded!" modal once per gift per
  device via localStorage "sos.celebrated"; Escape/button closes; focus moved in). Animations in
  `apps/family/app/magic.css` (family only; all off for prefers-reduced-motion). Illustrations: files in
  `apps/family/public/illustrations/` (house-night, house-day, gift-box; placeholders), paths ONLY in
  `apps/family/lib/illustrations.ts`, replacement guide `docs/illustrations.md`. Family text-foreground/70 → text-muted.
  E2E `browser-family-look.ts` (13). Review fixes: Celebration closes even with storage blocked (in-memory set),
  celebrates shipped/delivered gifts too, focus trap + Escape + scroll lock + focus return; ONE `ProgressBar` in
  @repo/ui (percent aria-valuenow + aria-valuetext = visible words; tones meter|magic) used by family MagicBar and
  store FundingMeter; hero/snow/sparkle colours are theme tokens (sky-day, sky-night(-mid), flake-day); snow falls
  only within the hero; getSessionUser decodes ONCE per request (React cache in @repo/auth guards); kid routes known
  only by `apps/family/lib/kid-path.ts`, ids via OBJECT_ID_PATTERN (@repo/lib/ids, also safeNext); gift browser
  explains when the child can't add (unregistered / season not open).
- **8.5.3 store + admin, calmer (2026-11-06).** SiteHeader gained an optional `nav` row (scrolls sideways on
  phones). Admin section links moved there (`apps/admin/components/admin-nav.tsx` client + `admin-nav-gate.tsx`:
  signed-in admins only); the list is `apps/admin/lib/sections.ts` (a plain module: a value exported from a
  "use client" file reaches server code only as a client reference, NOT data: caught by a screenshot check).
  Store/admin text-foreground/70 → text-muted (128). No animation in either app. Payout summary rows keyed.
  Review fixes: ONE `SectionNav` (@repo/ui/section-nav; layouts wrap|scroll, pass the app Link) for store dashboard
  + admin row; the nav draws its own row (no empty strip when signed out); inner padding keeps focus rings
  unclipped; current admin section scrolled into view on phones. Accepted trade-off: account menu and section row
  stream in as two Suspense islands (session decode is cached per request; a one-row pop-in for admins only).
- **8.5.4 wording, email, audit (2026-11-06).** Copy says "Christmas Magic" / "Magia Navideña" for points in
  every message file (code/data keep points/centipoints); PARENT_CONSENT/PRIVACY/TERMS versions bumped.
  Emails: `packages/email/src/render.ts` `EMAIL_COLORS` (site palette as literals: mail apps ignore CSS vars;
  light-only via color-scheme meta; Georgia/Segoe system fonts; contrast ratios in the comment are computed).
  **`scripts/e2e/browser-page-audit.ts`** (131 checks): every main page of the 3 apps (incl. parent pages behind
  the PIN, store owner, MFA admin) × light/dark → axe-core WCAG AA colour contrast + "form fields stay inside
  their card"; negative control proves it can fail; `--shots <dir>` saves full-page screenshots for review.
  axe-core pinned as a root devDependency. It found the store profile City/State/ZIP row overflowing its card:
  custom grid tracks need `minmax(0,…)` (a bare `1fr` won't shrink below an input's ~20ch minimum) →
  ONE `CITY_STATE_ZIP_ROW` in `@repo/ui/layout` used by store profile, store register and family address;
  admin/gift-search custom grids got minmax(0,1fr) too.
  Review fixes: PARENT_CONSENT_VERSION → "2026-11-06b-draft" ("2026-11-06-draft" had been used for older wording:
  never reuse; history in family.ts). **`SelectField` (@repo/ui/select-field)** = drop-down twin of TextField
  (shared `FIELD_CONTROL`, now w-full min-w-0); State is a US_STATES drop-down in store register/profile + family
  address, store server rule = `z.enum(US_STATES)` (was any 2 letters); row top-aligned (errors sit under boxes).
  Audit also checks fields at 700px and against <main> when no card (173 checks). EMAIL_COLORS ⊂ theme.css is a
  unit test (`@repo/email#test` input includes theme.css in turbo.json). Other selects still hand-styled → migrate.

## Phase 8 (QA & compliance) — decisions in memory phase8-plan

- **Slice 1a security headers (2026-11-06).** `@repo/lib/security-headers`: `nextSecurityHeaders({ stripe })` is the
  WHOLE next.config `headers` of each app (family: stripe true). No-nonce CSP (nonces break Partial Prerendering),
  Stripe origins from Stripe's official list, Vercel toolbar only when VERCEL_ENV=preview, HSTS + upgrade only when
  VERCEL=1 (local next start on http stays usable), HSTS without includeSubDomains. VERCEL/VERCEL_ENV are build env
  in turbo.json. Notes: docs/vendor/security-headers.md. Page audit fails on any ENFORCED CSP violation on our page,
  proves Stripe Embedded Checkout renders (child donation link), and has a CSP negative control (178 checks).
- **Slice 1b audit fixes (2026-11-06).** Independent audit: no critical/high; IDOR, webhook, injection, uploads,
  cron, unsubscribe, CSRF checked OK. Fixed: lockouts could be RACED by parallel guesses → `@repo/auth/attempts`
  (reserveAttempt BEFORE verify / failAttempt / releaseAttempt; `LOGIN_ATTEMPTS` in options.ts replaces
  recordFailedLogin; PIN uses PIN_ATTEMPTS). Every operator wrapped in trusted() on its own (sanitizeFilter checks
  nested objects). Per-IP cap on failed sign-ins 50/15 min/app (off in dev). resetPassword(raw, pw, ctx): keeps an active lock
  on MFA accounts, stamps parent consent.emailVerifiedAt when activating, sends `passwordChanged` alert email.
  E2E `scripts/e2e/auth-race.ts` (14): 50 parallel tries → exactly 5, real HTTP burst, reset cases.
  Review fixes: locks only GROW ($max); success update filtered by `unlocked()` (never wipes a lock set meanwhile);
  a crash mid-check releases the try (`settled` flag); per-IP cap counts only FAILED sign-ins (`overRateLimit` peek
  + hit on failure; skipped when IP unknown; verified on a prod build: 50 fails block, 60 successes pass); reset
  keeps only locks longer than LOCKOUT_MINUTES; alert in the owner's locale; PIN_ATTEMPTS lives in attempts.ts
  (parent-pin.ts needs Next, tests import the real rule). Accepted: a release can cancel one later strike in a rare
  interleaving (documented in attempts.ts).

- **Slice 2a account deletion (2026-11-07).** `@repo/families/erase`: eraseKid (replaces deleteKid, which deleted
  store-OWED wish rows) + eraseFamily + erasePreview. Open gifts → `releaseGiftInSession` (@repo/wishlists/engine,
  the ONE release path, also used by removeFromList) then all magic → one ledger "forfeit" (key erase:<kidId>, counted
  as kept by SoS in seasonMoney). Locked/shipped/delivered rows KEPT with `familyDeletedAt` (admin "Keep for Spirit of
  Santa" = same server step as Sent, no address/email). Deeds, votes, kid, family, parent user, email tokens deleted;
  ledger/payments/audit kept (ids only). Deed creation re-checks the kid under the kid-deeds lock. Page
  /parent/delete-account (PIN + password via `@repo/auth/reauth` verifyAccountPassword + DELETE/BORRAR), goodbye page
  /account-deleted, `accountDeleted` email, `@repo/auth/end-session` (expires __Host- cookies with their options).
  Server redirect, not reloadTo (cookie-changing action re-renders the current page → would bounce to sign-in).
  E2E `browser-family-erase.ts` (25). Stale `apps/*/tsconfig.tsbuildinfo` can hide NEW message namespaces: delete it.
  Review fixes: forfeit = available AFTER releasing open gifts (escrow of locked/shipped/delivered gifts was spent);
  one child deleted → locked gifts still go to the family; familyDeletedAt set at FAMILY level (all its rows, incl.
  earlier-deleted children); pay-later links found via PayLaterRequest.kidId, closed before AND after each child's
  transaction; part-way failure → "try again, it continues"; deed for a deleted kid → notFound; substitutes queue shows
  the notice; Lock button + end-session expire __Host- cookies with their options (bare delete() was ignored in prod:
  the PIN never really re-locked); split session cookies expired too. E2E now 28.

- **Spend at lock (2026-11-07, owner: "record magic as spend or we spend the same money twice").** Lock now books a
  ledger "spend" (key spend:<giftId>, final, never reversed) and lowers escrow in the SAME transaction
  (`lockGiftsInSession`, engine.ts). lockFundedItems: one transaction per KID, 120 s time budget (freeze day), returns
  {locked, spentCentipoints, failed, needsAttention, remaining}. Failures via `@repo/wishlists/ledger-errors`
  (classifyFailure): bad data → park (lockNeedsAttentionAt / closeNeedsAttentionAt), concurrent change → skip, database
  blip → stop, next run continues (closeUnfunded fixed the same way). Money cron fails while ANY gift is parked.
  Invariants in ONE place: `@repo/wishlists/ledger-check` (expectedBalances / ledgerProblems), used by E2Es.
  Old data: `npm run db:backfill-spend` (packages/db/scripts/backfill-spend-at-lock.ts): dry run default, --apply,
  --apply-production, --kid; never books gifts without escrow history; reports UNEXPLAINED_EXTRA / SHORT for a human.
  Deletion forfeits available only, logs escrowLeft/shortfall, never blocks. E2E `ledger-invariants.ts` (15).
  DEPLOY: production had NO locked gifts when this shipped (owner, 2026-11-07: prod DB empty), so the backfill is
  NOT needed there; just deploy before the first real gift locks. Dry run (no flags) any time is harmless.
  Review fixes (15-agent workflow, all verified): --kid fails CLOSED (a bad value used to widen the run to the whole
  database); deletion shortfall branch returns the store unit + compare-and-set; `remaining` counts the batch overflow;
  verify pass batched; stronger parked-gift test. E2E: ledger-invariants 16, browser-family-erase 31.

- **Deliver, then delete (2026-11-07, owner decision).** eraseFamily(parent, { mode }) — children ALWAYS erased now.
  mode "deliverFirst" (default; only if gifts locked/shipped AND an address that DECRYPTS): Family REBUILT by
  allow-list (familyName, address, deletionContactEnc = sealed {email, locale} with AAD deletionContactAad(fid),
  deletionRequestedAt, deletionDeadline = min(45 days, Jan 31) hard cap); User + ActionTokens deleted now (sessions
  die at next check, email free to re-register). `ownFamilyId` refuses closing families (every family action, even
  old sessions). Delivery email for a closing family = `giftOnItsWayClosing` (no child name, no sign-in link) to the
  kept contact. `finalizeClosingFamilies` in the money cron AFTER family notices: deletes once nothing awaits delivery
  and the notice was sent/given up, or at the deadline (then undelivered gifts → familyDeletedAt). Audit
  family.delete_requested / family.delete_finalized. Admin queue badge "send by". Delete page offers the choice;
  /account-deleted/closing. Privacy "keep" clause; PRIVACY + PARENT_CONSENT versions → 2026-11-07-draft.
  Found on the way: admin dashboard crashed on actor-less (system) audit rows → filtered (also store history);
  16 audit actions had no labels → added en/es + unit test (packages/db/test/audit-labels.test.ts).
  E2E `browser-family-deliver-then-delete.ts` (20).

- **Slice 2b "what we store" (2026-11-07).** /parent/our-data (PIN) + /parent/our-data/download (route handler, PIN, no-store,
  no-referrer, JSON attachment). ONE source: `familyDataExport` @repo/families/data-export (never hashes, tokens or
  encrypted blobs; address decrypted). Dashboard link next to "Delete our family account". E2E browser-family-our-data (10).

- **Year-round season, slice 1: calendar + reset gate (2026-11-07).** Plan + both critiques: docs/plans/year-round-season.md.
  SEASON_CALENDAR open Jan 1, freeze Dec 1, close = FIRST closed day Dec 26, shipBy Dec 10. Phases resetting | open |
  frozen | closed ("offseason" gone). `getSeasonState` adds the gate: last season's SeasonReset done, or no reset record
  AND no kid older than Jan 1 (fresh DB) → else "resetting". openDate no longer editable/ignored; freeze Nov 1–Dec 3,
  close Dec 26–31, a changed freeze ≥7 days away, dates lock at the freeze. runSeasonReset runs while resetting (EARLY in
  the cron), finishes even with kids flagged (needsAttention, cron fails loudly), admin /season "Run the season reset
  now" (audited season.reset_run). Webhook: tip/bonus/payup → RetryLaterError while resetting (Stripe redelivers).
  Donation split gated on the freeze DATE (a June force-freeze can't split). `newObjectId()` in @repo/db.
  Review fixes: `seasonAdminView` + `setForceFrozen` use the same `prevResetDone` gate (else the admin never saw
  "resetting"). needsAttention is a STORED alarm: `flaggedSeasonResets()` fails the money cron every day (result key
  `seasonResetFlagged`) until an admin ticks "Mark as handled" on /donations Season-end card
  (`clearSeasonResetAttention`, SeasonReset.attentionClearedAt/ByUserId, audited season.reset_attention_cleared).
  Split E2E uses a real freezeDate=today; proves a forced freeze before the freeze date → notYet.
- **Year-round slice 2: closed page (2026-11-07).** `familySiteClosed()` (@repo/stores/season) → "closed" (Dec 26–31) |
  "resetting" | null. apps/family/components/season-gate.tsx: `<SeasonGate>` wraps the page's `<main>` and shows the
  "Closed for Christmas / Getting the new season ready" card INSTEAD (gated page code never runs) on kids/[id] (+deed,
  gifts, gift, remove), /k, /d, /donate, parent/payup, parent/bonus, parent/register. Thanks/return pages NOT gated
  (a Dec 25 payment still shows its result). `<SeasonNotice>` banner on home + /parent; parent area, our-data,
  delete-account, sign-in, sign-up, legal stay open (COPPA rights never close). Server: startRegistration →
  `seasonClosed`; tips/bonus/donate/deeds/wish lists/pay-up already refused via their own windows. Messages
  `SeasonClosed.*`. E2E browser-family-closed.ts (26; simulates closure with closeDate=today, restores Season).
  Review fixes: the gate sits INSIDE `<main>` after the back link (PPR prerenders the frame; status placeholder while
  the season loads); the card has no `<main>`. Old "from October 1" copy → January 1 (en/es); unit test
  packages/lib/test/season-copy.test.ts keeps October out of all apps' copy. Noted for slices 3+4 (review): webhook
  still credits tips/bonus paid Dec 26–31 from checkouts opened before (giftWindow caps checkout at closeAt).
  NEXT slices: 3+4 TOGETHER lock-at-funding + per-gift ship window · 5 pay-up · 6 DtD deadline ·
  7 store Q1 + stock CAS · 8 docs/legal.
- **Year-round slices 3+4: lock at full funding + per-gift December ship window (2026-11-07).**
  Fully funded = SECURED: `isRemovable(status)` = "active" only (rules.ts; `lockAt`/`ITEM_LOCK_DAYS` deleted);
  `lockFundedItems` locks EVERY fully_funded gift at the next daily run (same spend-at-lock code). Ship rule, ONE
  place: `SeasonState.shipping {open, from=freeze date, by=Dec 10}` + pure `canShipGift(giftYear, s)` /
  `newestShippableYear(s)` / `shipLate(s, at)` in @repo/lib/season (last season = always shippable; force-freeze
  does NOT open the window). fulfilment.ts: storeOrders/orderCounts split ready vs held by it; `markShipped`
  filters `seasonYear <= newest` → `notYet`; `sendStoreDigests` covers this + last season, held gifts get ONLY
  setAsideNotifiedAt (Dec 1 "ship now" still fires), hash adds ship|hold + late, `remaining` when the 5000 cap
  is hit; Payment Links (pay-later texts) use the allow-list INSTANT_PAYMENT_LINK_METHODS ["card"]; orderCounts
  clamps at 0; email "FULLY FUNDED (ready tomorrow)" vs "HELD FOR DECEMBER" by `open`; email/store copy "Held for December" + "by {shipBy}" | "as soon as possible". Family card: "Secured:
  ships in December". Defaults kept: needsSubstitute gifts lock too (money secured, SoS finds a substitute).
  Webhook payments completed before Dec 26 00:00 but delivered later are still credited (correct: paid while
  open; Checkout expires_at is capped at close and EVERY magic checkout now excludes delayed methods via the
  shared `DELAYED_PAYMENT_METHODS` in @repo/payments/checkout — tips/donation links/bonus did not before); unspendable after Dec 25,
  they are wiped at the Jan 1 reset like any leftover magic. Backlog: "store can't supply a LOCKED gift" admin
  action, chargeback hold on held gifts, suspendStore vs held gifts. E2E: browser-store-orders (29) rewritten,
  wishlist-engine step 7/8.

## Open items / TODO

- **No DB integration test yet.** `connectDb()` and auth flows are untested against a real MongoDB.
  Next: Atlas dev cluster → seed script → sign-in test.
- **Security TODO:** Atlas DB user for the apps should have only `find`/`insert` on `transactions`
  (real ledger immutability); per-IP sign-in limit DONE (Phase 8 1b), tip endpoints limited per IP;
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
