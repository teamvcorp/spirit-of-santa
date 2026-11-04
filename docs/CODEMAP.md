# turboSanta CODEMAP

> Read this before exploring the repo, and keep it current as code is added.
> Last mapped: 2026-11-04. Status: **fresh scaffold, no business logic yet.**
> Product rules and constants are in [../CLAUDE.md](../CLAUDE.md).

## What exists today

| Path | State |
|---|---|
| `apps/family` | Default create-next-app page (Next 16.4.5, React 19.3.0, Tailwind v4) |
| `apps/store` | Same as family |
| `apps/admin` | Same as family |
| `packages/ui` | Turbo starter components (`button`, `card`, `code`); **no app imports it yet** |
| `packages/eslint-config` | Shared ESLint flat configs (`./base`, `./next-js`, `./react-internal`); **apps don't use it yet** |
| `packages/typescript-config` | Shared tsconfigs (`base`, `nextjs`, `react-library`); **apps don't use them yet** |

Git: one commit (`8aa8df2`, create-turbo). The starter apps `apps/web` and `apps/docs` have been
deleted in the working tree, and the three real apps are still untracked (not committed).

## Planned in CLAUDE.md but not created yet

- `packages/db`: Mongoose models and the connection helper (`MONGODB_URI`)
- `packages/auth`: NextAuth config and role helpers (`child | parent | store_owner | store_rep | admin`)
- `packages/lib`: `constants.ts` (`DOLLARS_PER_POINT`, season dates), shared utilities
- Zod, Stripe, Mongoose and NextAuth: none of these are installed yet

## App config (identical across all 3 apps)

`next.config.ts` turns on `cacheComponents`, `partialPrefetching`, `experimental.agentFeedback`, and runs
Tailwind through a Turbopack CSS loader rule. Each tsconfig is self-contained (`strict: true`,
`@/*` → app root) and does not extend `@repo/typescript-config`.

## Drift to fix before building features

1. **Version mismatch:** apps use React 19.3.0 and TS `^5`. `packages/ui` and the root use React 19.2.8 and TS 7.0.2.
   The apps also use eslint `^9`, while `@repo/eslint-config` uses eslint 10. Pick one set of versions.
2. Apps have no `check-types` script, so `turbo check-types` skips them.
3. Apps don't depend on `@repo/ui`, `@repo/typescript-config` or `@repo/eslint-config`.
4. There is no `.env.example`. Env vars must be listed in `turbo.json`
   (`env` / `globalEnv`) so the build cache invalidates when they change. They are not listed yet.
5. The root README is still the create-turbo boilerplate.

## Local docs (version-matched, offline; read these instead of guessing or searching the web)

- **Next.js 16:** `apps/<app>/node_modules/next/dist/docs/` or `node_modules/next/dist/docs/`
  (`01-app/`, `03-architecture/`, …). The `apps/*/AGENTS.md` files say Next 16 has breaking changes, so read these docs first.
- **Turborepo:** `node_modules/turbo/docs/` (start at `README.md`), as directed by the root `AGENTS.md`.
- These docs live in node_modules, so they come back with `npm install`. Copy pages into `docs/vendor/` only
  for third-party APIs we add that don't ship their own docs (Stripe, NextAuth, and so on).

## Commands

Node >=24 (v26 installed) and npm 11.20 workspaces.
`npm run dev | build | lint | check-types` runs through turbo. To target one app, add `--filter=family`.
