# Spirit of Santa — launch checklist (owner)

Everything the code can test by itself is automated (`scripts/e2e`, the page audit, the load-test script). This is
what needs a person: settings only you can enter, things to try on real phones, and the beta. Tick as you go.
Written 2026-11-07. There are no real users yet, so nothing here needs a data migration.

## 1. Before anyone outside the team uses the site

- [ ] **Lawyer review** of the items in `docs/legal/lawyer-packet.md`. If the wording changes after families have
      signed up, tell the developer first: a "please agree again" step must be built before that change goes live.
- [ ] **Charity details for receipts:** Edynsgate's legal name, EIN and mailing address, then in admin
      **Settings** switch receipts on and choose the date receipts start.
- [ ] **Admin Settings:** platform fee % (the /donate page stays closed until it is set) and Spirit of Santa's
      shipping address (stores can't be told where to ship until it is set).
- [ ] **Twilio toll-free verification** approved (pay-later texts fail until then). Note: the text is English
      only; a Spanish version would also need registering (ask the developer if you want one).
- [ ] **Stripe:** live keys in the family project and the live webhook endpoint with the 10 events listed in
      `docs/vendor/stripe.md`; one small real payment to yourself to confirm, then check it in admin.
- [ ] **Stripe: Spirit of Santa's own payment-method group, LIVE** (owner 2026-11-08: no crypto, Link off for Spirit
      of Santa ONLY; the VA Corp account's Default stays as it is for its other products). Dashboard (live mode) →
      Settings → Payment methods → create a new configuration named **Spirit of Santa** with the same methods as Default
      but **Link off** → copy its `pmc_…` id → Vercel **family** project → `STRIPE_PAYMENT_METHOD_CONFIG` (Production)
      → redeploy. Then open a tip checkout: no Link / Bank / Crypto. (TEST group already exists: pmc_1UZZX9…t354.)
- [ ] **Logo** file (see `docs/illustrations.md` for the image slots you can replace).
- [ ] **First admin** can sign in with the authenticator app; a second admin set up so you are never locked out.

## 2. Load test (once, on a Vercel Preview — never the live site)

1. In each Vercel project, add **Preview-only** variables (never copy production secrets):
   `MONGODB_URI` = the **dev** database, `MONGODB_DB` = the dev database name, a new `NEXTAUTH_SECRET`,
   new test values for `DEED_QR_KEY` and `ADDRESS_ENCRYPTION_KEY` (same value in family + admin), `BLOB_STORE_ID`,
   and Stripe **test** keys. Leave `RESEND_API_KEY` and the `TWILIO_*` variables **unset** on Preview.
2. Vercel → each project → Settings → Deployment Protection → **Protection Bypass for Automation**: create the
   secret.
3. Push any branch (not main) to get preview URLs for the family and store apps.
4. In a terminal, set the bypass secret for this terminal only (PowerShell):
   `$env:VERCEL_AUTOMATION_BYPASS_SECRET = "<the secret>"`, then run
   `node scripts/load/load-test.ts --family <family preview URL> --store <store preview URL> --users 50 --seconds 60`.
5. Run it twice (the first run includes cold starts). Every line should say PASS (errors under 1%, 95% of pages
   under 1.5 s). Send the developer the table if anything fails.

## 3. Phones and browsers (about an hour)

On an **iPhone (Safari)**, an **Android phone (Chrome)**, and a computer with **Chrome** and **Firefox**:

- [ ] Sign up as a parent (both English and Spanish), add a child, pay the $5 registration with a Stripe test card.
- [ ] Kid view: record a good deed, open its QR code, scan it with a second phone, say thank you, and tip.
- [ ] Browse gifts, add one to the wish list, give through the child's donation link, watch the bar fill.
- [ ] Parent area: PIN unlock, bonus magic, address, notifications, "what we store", delete a test child.
- [ ] Store: sign up, add an item with a photo, see it in the family gift browser, mark an order shipped.
- [ ] Rotate each phone; zoom text to 200%; nothing should be cut off or overlap.

## 4. Accessibility by hand (the automated audit covers colours, labels and structure)

- [ ] Keyboard only (Tab, Shift+Tab, Enter, Space) through sign-up, recording a deed, and checkout: you can always
      see where you are, and never get stuck.
- [ ] Screen reader for a few minutes (iPhone VoiceOver or Windows Narrator) on the kid page and the QR page: the
      buttons and progress bars are read out sensibly.

## 5. Beta (10–20 families, 5–10 stores, Storm Lake area)

- [ ] Approve the beta stores in admin and agree each store's discount.
- [ ] Ask each family to: sign up, register a child, do two good deeds with someone outside the family, and build a
      wish list; ask each store to list at least 10 items with photos.
- [ ] Collect problems in one place (what they did, phone, screenshot). Check admin **Moderation** daily for
      nicknames and deed texts.

## 6. The season, month by month (what runs by itself and what you do)

The daily money job runs every morning (about 2 am Chicago time) on the live site.

| When | Automatic | You |
|---|---|---|
| Jan 1 | Last season's leftover magic resets; site reopens; stores' active items are copied into the new season | Check admin **Season** shows the season open |
| Jan 1 – Mar 31 | Stores can add and change items | Remind stores to review their catalogue by Mar 31 |
| All year | Gifts lock when fully funded and are held by the store | Moderation queue; approve new stores |
| Late Nov | Reminder emails before the freeze | — |
| Dec 1 | Wish lists freeze, giving closes, community donations are shared (needs the fee set), store "ship now" emails | Confirm the share-out ran (admin **Donations**) |
| Dec 1–3 | Parents can finish gifts (pay-up) | — |
| Dec 4 | Unfinished gifts drop off | — |
| By Dec 10 | Stores ship to Spirit of Santa | Mark gifts received and sent to families in admin **Fulfilment** |
| Dec 26–31 | Family site closed | Pay stores (admin **Payouts**); deliver late gifts |

Some problems show in admin (e.g. the share-out waiting for the fee on **Donations**, or a reset needing
attention); every problem makes the daily job report a failure in the Vercel logs (family project → Logs).
