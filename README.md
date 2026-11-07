# Spirit of Santa

Community-service incentive platform: kids earn Christmas Magic points for good deeds and
spend them on a funded Christmas wish list. Roadmap: [SpiritOfSanta.md](SpiritOfSanta.md).
Conventions: [CLAUDE.md](CLAUDE.md). Repo map: [docs/CODEMAP.md](docs/CODEMAP.md).

| App | Local | Production |
|---|---|---|
| `apps/family` | http://localhost:3000 | spiritofsanta.com |
| `apps/store` | http://localhost:3001 | store.spiritofsanta.com |
| `apps/admin` | http://localhost:3002 | admin.spiritofsanta.com |

## Setup

Requires Node >= 24 and npm 11.

```sh
npm install
# per app: copy the template and fill in values (never commit .env.local)
cp apps/family/.env.example apps/family/.env.local
npm run dev                 # all three apps
npx turbo dev --filter=store  # one app
```

## Checks (run before every commit)

```sh
npm run lint && npm run check-types && npm run build
```
