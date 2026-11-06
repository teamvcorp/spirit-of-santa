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
| `CRON_SECRET` | – | ✓ | – | long random string (protects the daily jobs: sign-up cleanup + donations) |
| `STORE_APP_URL` | – | – | ✓ | `https://store.spiritofsanta.com` |
| `MFA_ENCRYPTION_KEY` | – | – | ✓ | NEW random value (command below). Encrypts admin authenticator secrets. Keep a copy somewhere safe: if it's lost, every admin re-runs setup |
| `STRIPE_SECRET_KEY` | ✓ | – | – | Stripe live secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✓ | – | – | Stripe live publishable key |
| `STRIPE_WEBHOOK_SECRET` | ✓ | – | – | `whsec_` of the endpoint below |
| `DEED_QR_KEY` | ✓ | – | – | NEW random value (same command as secrets). Key for kids' QR links; changing it voids unused QR codes |
| `FAMILY_PROMO_CODE` | ✓ | – | – | Optional. Families who enter it pay the $5 child registration once (first child). Blank = promo off |

Later phases (leave unset for now): `TWILIO_*` (pay-later SMS), `FCM_*` / `NEXT_PUBLIC_FCM_*` (push).

**Vercel UI gotcha:** after saving, the list may not refresh. Retrying then fails with "already exists
… on branch". Press Ctrl+F5 before re-adding anything; to change a value use ⋯ → Edit.

**Build fails with `$'\342\200\242': command not found` / exit 127:** the project's Build Command
(Settings → Build and Deployment) was pasted WITH backticks: `` `cd ../.. && npx turbo run build --filter=admin` ``.
Backticks mean "run this, then run its output" in the shell, so after the build Vercel tries to execute
turbo's printed "•" bullet (bytes \342\200\242). Type it without backticks, or turn the override off and let
Vercel's Turborepo detection build it. Check all three projects.

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

## 3. Services

- **Stripe** → Workbench → Webhooks → endpoint `https://spiritofsanta.com/api/webhooks/stripe`,
  "Your account", **Snapshot**, API version **`2026-09-30.endive`**, the 10 events listed in
  `docs/vendor/stripe.md`. Copy its `whsec_` to the family project.
- **Resend**: domain `fyht4.com` verified (done). Sending-only API key.
- **Vercel Blob**: public store. Connect it to the **store** project (all environments).
- **Vercel Cron** (2 jobs, the Vercel Hobby maximum):
  - store: `apps/store/vercel.json` → `/api/cron/purge-signups` (unconfirmed sign-ups).
  - family: `apps/family/vercel.json` → `/api/cron/money` 08:00 UTC (donation split, Jan 1 season end, pay-later link
    expiry, waiting tax receipts). Lives in the family app because it has the Stripe/Twilio/email secrets.
  Both need `CRON_SECRET` (same long random value is fine) in their Vercel project.
- **Twilio (family project):** `TWILIO_ACCOUNT_SID` (AC…), `TWILIO_AUTH_TOKEN` (or `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`),
  `TWILIO_PHONE_NUMBER` in E.164 (+1…) or `TWILIO_MESSAGING_SERVICE_SID`. Texts only go out once Toll-Free Verification
  is approved. See docs/vendor/twilio.md.
- **Before Dec 1 (admin):** set the platform fee in /settings (the split refuses to run without it), and
  for tax receipts the charity name + EIN + "receipts cover gifts from" day.
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

Then sign in at `https://admin.spiritofsanta.com/signin` (leave the code box blank the first time).
You'll be asked to set up two-step sign-in: scan the QR code with an authenticator app
(Google/Microsoft Authenticator, 1Password), type the code, and **save the 10 recovery codes**.
**Sign-in says "That didn't work" but the account was created?** (2026-11-06) Every SERVER error during sign-in shows
that same message on purpose. Vercel → admin → Logs shows the real reason: `[auth] sign-in refused (admin): <reason> · db=<database>`
(reasons: no_account, bad_password, locked, not_active, wrong_app, code_missing/code_wrong/code_reused) or
`[auth] sign-in error:` for a crash. `no_account · db=test` = MONGODB_URI has no database name. Check:
1. `npm run admin:check` (read-only, same env vars as admin:create) using the EXACT `MONGODB_URI` from the
   Vercel admin project: must say database "spiritofsanta", account found, `password matches: YES`.
   "no account" → the site uses another database/cluster than the one you created the admin in.
2. Atlas → Network Access must allow Vercel (`0.0.0.0/0`; Vercel IPs change). Log shows `MongooseServerSelectionError`.
3. `MFA_ENCRYPTION_KEY` (32 bytes base64url) set in the admin project, and the project REDEPLOYED after any env change.

Lost phone and recovery codes? Re-run `npm run admin:create` for that email: it resets the password
and two-step sign-in. (The password is hashed with argon2id and
never printed; re-running resets it and signs out old sessions.)

## 6. Store item window and season dates

Admin app → **Season** (`/season`). Stores can add/price items Jan 1 – Mar 31 automatically; to onboard
stores earlier, set the store item window to **Open now** (and back to **Automatic** later). Season dates
(open / freeze / close) can be changed there until that season opens; after that they lock and only the
**emergency freeze** switch is available. Every change is in the audit log.

## 7. Before announcing

- Review the DRAFT store agreement wording (`apps/store/messages/*.json` → `StoreAgreement`).
- Confirm the sender address and set `RESEND_REPLY_TO`.
- Smoke test on production: store sign-up → confirm email → admin approve → add an item.
