# Production setup checklist (as of 2026-11-05, end of Phase 2 slice 4)

Everything needed before real stores use the site. Templates with comments:
`apps/<app>/.env.example`. Never put production secrets in `.env.local` or in git.

## 1. Vercel projects and domains

| Project (root dir) | Domain |
|---|---|
| family (`apps/family`) | `spiritofsanta.com` (pick apex OR www and redirect the other; Stripe needs the exact host) |
| store (`apps/store`) | `store.spiritofsanta.com` |
| admin (`apps/admin`) | `admin.spiritofsanta.com` |

Node.js version: 24.x (Project → Settings → General).

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | family | store | admin | Value / where to get it |
|---|:-:|:-:|:-:|---|
| `MONGODB_URI` | ✓ | ✓ | ✓ | Atlas, database **`spiritofsanta`** (not `_dev`), `&appName=sos-<app>` |
| `NEXTAUTH_SECRET` | ✓ | ✓ | ✓ | NEW random value per app (don't reuse dev ones) |
| `NEXTAUTH_URL` | `https://spiritofsanta.com` | `https://store.spiritofsanta.com` | `https://admin.spiritofsanta.com` | this app's public URL |
| `RESEND_API_KEY` | ✓ | ✓ | ✓ | Resend → API Keys (sending access, fyht4.com only) |
| `RESEND_FROM` | opt | opt | opt | blank = `Spirit O Santa <no-reply@fyht4.com>` |
| `RESEND_REPLY_TO` | opt | opt | opt | a monitored inbox (recommended) |
| `BLOB_STORE_ID` | ✓ | auto | ✓ | not secret; store project gets it by connecting the Blob store |
| `BLOB_READ_WRITE_TOKEN` | – | auto/✓ | – | connect the Blob store to the **store** project only (OIDC); token only if not using OIDC |
| `CRON_SECRET` | – | ✓ | – | long random string (protects the daily cleanup job) |
| `STORE_APP_URL` | – | – | ✓ | `https://store.spiritofsanta.com` |
| `STRIPE_SECRET_KEY` | ✓ | – | – | Stripe live secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✓ | – | – | Stripe live publishable key |
| `STRIPE_WEBHOOK_SECRET` | ✓ | – | – | `whsec_` of the endpoint below |

Later phases (leave unset for now): `TWILIO_*` (pay-later SMS), `FCM_*` / `NEXT_PUBLIC_FCM_*` (push).

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 3. Services

- **Stripe** → Workbench → Webhooks → endpoint `https://spiritofsanta.com/api/webhooks/stripe`,
  "Your account", **Snapshot**, API version **`2026-09-30.endive`**, the 10 events listed in
  `docs/vendor/stripe.md`. Copy its `whsec_` to the family project.
- **Resend**: domain `fyht4.com` verified (done). Sending-only API key.
- **Vercel Blob**: public store. Connect it to the **store** project (all environments).
- **Vercel Cron**: defined in `apps/store/vercel.json` (daily purge of unconfirmed sign-ups).
  Needs `CRON_SECRET` in the store project.
- **MongoDB Atlas**: allow Vercel to connect (Network Access). Recommended: one DB user per app
  (least privilege), and for the ledger, a role with only find/insert on `transactions` and
  `auditlogs` (see CODEMAP "Security TODO").

## 4. One-time database step (required)

Production doesn't build indexes automatically. Unique indexes prevent double-crediting
payments and reuse of email links; TTL indexes run the cleanups. Run once (and after any
index change), with the PRODUCTION URI:

```powershell
$env:MONGODB_URI = "<production URI>"; npm run db:sync-indexes; Remove-Item Env:MONGODB_URI
```

## 5. First admin account

There's no public admin sign-up (by design). From your computer, with the PRODUCTION URI:

```powershell
$env:MONGODB_URI = "<production URI>"; $env:ADMIN_EMAIL = "you@example.com"; $env:ADMIN_PASSWORD = "<long passphrase>"
npm run admin:create
Remove-Item Env:MONGODB_URI, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

Then sign in at `https://admin.spiritofsanta.com/signin`. (The password is hashed with argon2id and
never printed; re-running resets it and signs out old sessions.)

## 6. Store item window

Stores can add/price items Jan 1 – Mar 31 automatically. To open it earlier for onboarding,
set the season's `storeWindow` to `"open"` (admin control arrives with Phase 3 season settings).

## 7. Before announcing

- Review the DRAFT store agreement wording (`apps/store/messages/*.json` → `StoreAgreement`).
- Confirm the sender address and set `RESEND_REPLY_TO`.
- Smoke test on production: store sign-up → confirm email → admin approve → add an item.
