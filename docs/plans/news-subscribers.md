# News subscribers → Resend segment (owner 2026-11-12)

> Status: slice 1 (public form + confirm) DONE. Slice 2 (parents) and slice 3 (donors + admin count) next.
> Correction 2026-11-12: no second key needed — the owner's family RESEND_API_KEY is already full access.

## Context
The owner added `RESEND_SEGMENT_ID` and wants to start collecting subscribers for **news / marketing broadcasts**,
sent from the Resend dashboard. Owner choices on who can subscribe:
- parents, through an opt-in box;
- anyone, through a public signup form;
- donors and tippers, through a box at checkout.

Children are never added. Every box starts **unticked**.

## Key constraints found
- **The current `RESEND_API_KEY` has sending access only, so it cannot create contacts.** Resend has no
  contacts-only permission, so the owner must create a separate **full-access** key named
  `RESEND_CONTACTS_API_KEY`. It goes in the **family** Vercel project only and is read by one server-only module.
- **Nothing is pushed to Resend before the email is proven.**
  - Parents are added after `verifyEmail`, because unverified sign-ups are purged after 48 h.
  - Public-form and donor emails get a **confirm-by-email** link. This double opt-in stops anyone signing up
    someone else's address.
- **Stripe gives us the donor's email only after payment.** The opt-in is a box on *our* form. It travels in the
  checkout metadata (`sos_news`) and is matched to `customer_details.email` once the payment succeeds.
- **The privacy policy currently says nothing about news emails.** It gets a new section and a `PRIVACY_VERSION`
  bump. The parent consent version is unchanged, because news is a separate, optional box.

## Design
1. **Data** (`packages/db`)
   - **New `NewsSubscription` model**, one row per email: email (lowercase), source
     (`parent|public|donor|tip`), locale, `consentText` version, consentAt, confirmedAt, unsubscribedAt,
     resendSyncedAt. This is our own proof of consent and the source of the admin count.
   - **`ActionToken`** gets a new purpose, `news_confirm`. It reuses the existing hashed, single-use,
     expiring links, with a 7-day lifetime.
2. **Resend contacts module**: `packages/email/src/contacts.ts`, server-only.
   - `subscribe(email, {firstName?, locale})`: create the contact with `segments:[{id}]` and
     `unsubscribed:false`. If the contact already exists, add it to the segment and set it subscribed (fresh
     consent).
   - `unsubscribe(email)`: set `unsubscribed:true`.
   - `removeContact(email)`: used when an account is deleted.
   - It follows the dev no-send rule: it prints the call instead unless `EMAIL_DEV_SEND=true`.
   - It throws only `{name, message}` and never logs addresses.
   - Notes go in `docs/vendor/resend.md`.
3. **Service**: `packages/families/src/news.ts`
   - `requestNews(email, source, locale, meta)`:
     - rate limits: per IP via `publicLimit`, plus a **silent** per-email limit via `emailKey`;
     - sends a confirm email with a new `newsConfirm` template (en + es);
     - always answers "check your inbox", so it never reveals whether an address is already subscribed.
   - `confirmNews(token)`: consumes the ActionToken, upserts `NewsSubscription`, then calls `subscribe`.
   - `setParentNews(parent, on)`: used on registration once verified, and by the settings page.
   - Unsubscribing is Resend's job: broadcasts use Resend's own unsubscribe link and Resend marks the contact
     unsubscribed. Turning news off in our settings sets the contact unsubscribed too.
4. **Pages** (family app)
   - **Public form** on the home page, after the two-paths section:
     - fields: email, an unticked "I'm 18 or older and want Spirit of Santa news (a few emails a year)" box,
       and a honeypot;
     - it reuses `useHydrated`, `atLeast` and `publicLimit`.
   - **`/news/confirm?t=`**: the GET only shows a "Confirm" button and the POST action confirms. This stops email
     link scanners from confirming automatically.
   - **Parent registration**: an optional `newsOptIn` box, stored as pending on the User row. The parent is
     subscribed at `verifyEmail`, and never on the early return for an email that already exists.
   - **`/parent/notifications`**: a "News from Spirit of Santa" toggle. A missing value means OFF, the opposite of
     the other kinds, which default to ON.
   - **Donate and tip forms** (`/donate`, `/d/<code>`, `/k/<code>`): an unticked box.
     - It sets `sos_news:"1"` in the metadata.
     - After the payment succeeds, a best-effort, idempotent hook reads the session email and calls
       `requestNews`, so a confirm email follows.
     - Reuse the session lookup in `receipts.ts`.
5. **Deletion and export**
   - `eraseFamily` calls `removeContact`, best-effort and after the transaction, and deletes the
     `NewsSubscription`.
   - The data export shows the news status.
6. **Admin**: a "News subscribers" count on the dashboard (confirmed and not unsubscribed, by source).
7. **Legal and copy**
   - Privacy: a new `news` section (en + es) and a `PRIVACY_VERSION` bump.
   - lawyer-packet note.
   - Checklist: the owner adds the mailing address and unsubscribe link to the Resend broadcast footer, as
     CAN-SPAM requires.

## Env (owner pastes the values; I never see them)
- **Family project:** `RESEND_CONTACTS_API_KEY` (full access) and `RESEND_SEGMENT_ID`.
- **Also:** add both to `turbo.json` and `apps/family/.env.example`.

## Slices (each one: build, E2E, review, then push)
1. Core: model, contacts module, public form, confirm page, privacy text.
2. Parents: registration box, settings toggle, deletion and export.
3. Donors: checkout boxes and the post-payment hook. Admin count.

## Verification
- Unit tests: token and limit logic; `contacts.ts` in dev mode prints instead of calling Resend.
- Browser E2E on the `*_dev` database:
  - public sign-up, then the confirm email printed in the log, then confirm, then a `NewsSubscription` row;
  - a repeat request gives the same answer;
  - parent registration with the box ticked, then verify, then subscribed; the settings toggle turns it off;
  - donation with the box ticked plus a signed test webhook, then a confirm email is queued;
  - account deletion removes the subscription.
- One live check against Resend using the owner's key, with `EMAIL_DEV_SEND=true` and a `delivered@resend.dev`
  address, to confirm the contact shows up in the segment. Then delete that test contact.
- Run `npx turbo run lint check-types test build` and the page audit.
