# Resend (`resend` 6.34.1): our notes

> Saved 2026-11-05 from resend.com/docs (send-with-nodejs) and the installed types
> (`node_modules/resend/dist/index.d.mts`). Code: `packages/email`.

## Setup

- Sending domain **fyht4.com** (verified by the user). From: `RESEND_FROM`, default
  `Spirit O Santa <no-reply@fyht4.com>`.
- `RESEND_API_KEY` in each app's env (store, admin, family). Create it with **sending access
  only**, restricted to fyht4.com (least privilege: a leaked key can't read logs/contacts).
- Turbo: `RESEND_API_KEY`, `RESEND_FROM` are in `turbo.json` build env.

## API facts (v6)

- `new Resend(key).emails.send(payload, requestOptions?)` → `{ data: { id } | null, error: { name, message } | null }`.
  **Does not throw for API errors**: always check `error`. Our wrapper turns it into a throw.
- **`idempotencyKey` goes in the SECOND argument** (`requestOptions`), per the installed types.
  (The web docs' summary showed it in the payload; trust the types.) Window 24 h, max 256 chars,
  pattern `<event>/<id>`.
- Payload: `from`, `to` (≤ 50), `subject`, `html` and/or `text` (or `react`), `replyTo`,
  `headers`, `tags: [{ name, value }]` (ASCII ≤ 256), `scheduledAt`, `attachments` (≤ 40 MB).
- Rate limit: 10 requests/s per team (429 above that).
- **Batch** (resend 6.x): `resend.batch.send([...payloads], { idempotencyKey })`: max **100** emails per request, one
  idempotency key for the whole batch, no attachments / scheduledAt. Used for Phase 7 daily digests (`sendEmailBatch`).
- **One-click unsubscribe** (Gmail/Yahoo bulk-sender rules, RFC 8058): headers `List-Unsubscribe: <https://...>` +
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; the URL must accept a POST with no sign-in (`/api/unsubscribe`).
- **Test inboxes** (no reputation impact): `delivered@resend.dev`, `bounced@resend.dev`,
  `complained@resend.dev`; labels allowed: `delivered+anything@resend.dev`.

## Our rules (packages/email)

- Templates: `src/render.ts` (pure, unit-tested), text in `messages/{en,es}.json` (parity-tested
  with the other message files). Every value is HTML-escaped; links must be https on
  `*.spiritofsanta.com` (or http://localhost in dev), else render throws.
- **Development never sends unless `EMAIL_DEV_SEND=true`**: emails are printed to the server log
  (`[email:dev] to=... template=...` + text with the link). Production always sends, and throws
  if `RESEND_API_KEY` is missing. Reason: on 2026-11-05 two E2E runs sent real emails to fake
  `@spiritofsanta.test` addresses (bounces hurt the sending domain).
- Translation outside Next: `createTranslator` from **`use-intl/core`** (next-intl's
  framework-free core). `next-intl`'s own export pulls in `next/headers` under the
  react-server condition and fails in plain Node tests.
- Never log recipients or bodies (one-time links). Log template name + error only.
