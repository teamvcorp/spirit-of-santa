# Spirit of Santa — Monorepo

## Project structure
Three Next.js apps (App Router) + shared packages in a Turborepo monorepo.
All apps share one MongoDB cluster (env var: MONGODB_URI).

## Apps
- apps/family   → spiritofsanta.com
- apps/store    → store.spiritofsanta.com
- apps/admin    → admin.spiritofsanta.com

## Shared packages
- packages/db        → Mongoose models & connection helper
- packages/auth      → NextAuth config & role helpers
- packages/ui        → Shared React components
- packages/lib       → Conversion rates, constants, utilities

## Key constants (never hard-code)
- DOLLARS_PER_POINT = 1.50  (server-side only — packages/lib/constants.ts)
- Season (year-round, owner 2026-11-07): open Jan 1 | Freeze + giving closes Dec 1 | Pay-up 3 days after the Dec 1 share-out, then unfinished gifts drop off | Stores ship by Dec 10 | Last day Dec 25 | Closed Dec 26–31 | Reset + reopen Jan 1 | Gifts lock (secured) at full funding, held by stores, ship in December | Store items editable Jan 1–Mar 31 only; last season's items copied Jan 1 (plan: docs/plans/year-round-season.md)

## Conventions
- TypeScript strict mode everywhere
- Zod for all API route input validation
- Server Actions over client fetch where possible
- Never trust client-sent point values — recompute server-side
- All Stripe calls server-side only (never expose secret key)
- Role enum: child | parent | store_owner | store_rep | admin