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
- Season open: Oct 1 | Freeze: Dec 1 | Close: Dec 25 | Reset: Jan 1

## Conventions
- TypeScript strict mode everywhere
- Zod for all API route input validation
- Server Actions over client fetch where possible
- Never trust client-sent point values — recompute server-side
- All Stripe calls server-side only (never expose secret key)
- Role enum: child | parent | store_owner | store_rep | admin