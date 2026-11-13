# Resend (`resend` 6.34.1): our notes

> Saved 2026-11-05 from resend.com/docs (send-with-nodejs) and the installed types
> (`node_modules/resend/dist/index.d.mts`). Code: `packages/email`.

## Setup

- Sending domain **fyht4.com** (verified by the user). From: `RESEND_FROM`, default
  `Spirit of Santa <no-reply@fyht4.com>`.
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

## Contacts + segments (news subscribers, 2026-11-12)

Saved from resend.com/docs (contacts/create-contact, add-contact-to-segment, broadcasts, managing-unsubscribe-list,
api-keys) and the installed types (resend 6.34.1). Code: `packages/email/src/contacts.ts` (Resend calls) and
`packages/auth/src/news.ts` (who may be subscribed, consent record). Plan + rules: CODEMAP "News subscribers".

- **Key permission:** contacts need a **full_access** key; `sending_access` "can only send emails". There is no
  contacts-only scope. Code uses `RESEND_CONTACTS_API_KEY` if set, else `RESEND_API_KEY`. The owner's family key
  was full access on 2026-11-12 (checked by reading the segment). Hardening TODO: give the store + admin apps their
  own **sending-only** keys (they never need contacts).
- **Segments replaced "audiences"** (`audienceId` is deprecated). `RESEND_SEGMENT_ID` = the "santa" segment.
- `contacts.create({ email, unsubscribed, segments: [{ id }] })` fails for an address that already exists, so we
  `contacts.update({ email, unsubscribed: false })` first (`not_found` → create), then
  `contacts.segments.add({ email, segmentId })` (POST /contacts/{email}/segments/{segmentId}).
- `contacts.update({ email, unsubscribed: true })` = global unsubscribe (no broadcasts at all; transactional emails
  still go). `contacts.remove({ email })` deletes it (account deletion). `not_found` on both = already done.
- **Broadcasts** (dashboard) go to a segment; include Resend's unsubscribe link placeholder in the editor and Resend
  marks the contact unsubscribed itself. CAN-SPAM: every broadcast also needs the postal address in its footer.
- **Rate limit 10 requests/s**: one subscribe = up to 3 calls; a fast burst in the live check got 429. The daily
  retry (`syncPendingNews`) waits 400 ms between contacts.
- The SDK prints `[Resend API Error]` with the request path (which holds the EMAIL) to the console, but **only when
  NODE_ENV !== "production"** (index.mjs `logError`), so production logs stay clean.
- Live check 2026-11-12 (owner approved): create → in segment, unsubscribe → `unsubscribed: true`, re-subscribe an
  existing contact → subscribed + in segment, remove → gone. Test contact deleted; segment left empty.
