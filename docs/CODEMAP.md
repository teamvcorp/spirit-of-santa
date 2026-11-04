# turboSanta CODEMAP

> Read this before exploring. Keep it current when packages/routes are added.
> Last updated: 2026-11-04. Status: **Phase 1 foundation: shared packages done, no UI yet.**
> Rules/constants: [../CLAUDE.md](../CLAUDE.md). Roadmap: [../SpiritOfSanta.md](../SpiritOfSanta.md).

## Layout

| Path | What |
|---|---|
| `apps/family` :3000 | Next 16 app. `auth.ts` (authOptions), `app/api/auth/[...nextauth]/route.ts`; default home page |
| `apps/store` :3001 | Same skeleton |
| `apps/admin` :3002 | Same skeleton |
| `packages/lib` | Client-safe: `season`, `roles`, `limits`, `format`. **Server-only:** `constants`, `points` |
| `packages/db` | `connectDb()` + 10 Mongoose models (server-only) |
| `packages/auth` | NextAuth v4 options, guards, argon2id hashing, parent PIN (server-only) |
| `packages/ui` | Turbo starter components (unused so far) |
| `packages/eslint-config` | `./base` (packages), `./next-js` (apps). only-warn + `--max-warnings 0` |
| `packages/typescript-config` | `base`, `nextjs` (apps), `library` (lib/db/auth), `react-library` (ui) |
| `docs/vendor/` | Version-specific notes: `mongoose-9.md`, `next-auth-v4.md` |

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

## Open items / TODO

- **No DB integration test yet.** `connectDb()` and auth flows are untested against a real MongoDB.
  Next: Atlas dev cluster → seed script → sign-in test.
- **Security TODO:** Atlas DB user for the apps should have only `find`/`insert` on `transactions`
  (real ledger immutability); per-IP rate limiting on sign-in & tip endpoints (Vercel Firewall/Upstash);
  admin MFA (roadmap); production `syncIndexes` script (autoIndex is off in prod).
- **Account lockout can be abused** to lock out a known email for 15 min. Acceptable now; per-IP limiting mitigates.
- `npm audit`: 10 moderate (minimatch ReDoS) in the ESLint dev toolchain only, not shipped. Not force-fixed.
- Login UI (`pages.signIn`), sign-up/registration, email verification: not built.
- Apps' `layout.tsx` still has create-next-app metadata/content.
- `vercelsetup.md` (user's draft) conflicts with the repo: Node 20.x → **24.x**; Turbo `pipeline` → `tasks`;
  `STRIPE_PUBLISHABLE_KEY` → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; `FCB_` → `FCM_`.
- Product decisions assumed (confirm): fractional points (centipoints); `MAX_TIP_CENTS` $1,000;
  default kid `itemCap` 5; family session 30 days.
