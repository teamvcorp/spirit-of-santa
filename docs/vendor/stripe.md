# Stripe (`stripe` 23.0.1, API `2026-09-30.endive`): our notes

> Saved 2026-11-05 from docs.stripe.com/webhooks and the installed package
> (`node_modules/stripe/CHANGELOG.md`, `esm/Webhooks.d.ts`). Code: `packages/payments`,
> route `apps/family/app/api/webhooks/stripe/route.ts`, E2E `scripts/e2e/stripe-webhook.ts`.

## Decisions

- **No Stripe Connect** (2026-11-04): stores are paid by check or outside the app.
- **No refunds at all** (2026-11-05): points are never taken back. If a refund is made in the
  Dashboard or a chargeback happens (banks can force one), the webhook records it on
  `Payment` and flags it for admin. **Tip/bonus/donation pages must say "All tips and
  donations are final"** (card networks expect a stated refund policy).
- **Snapshot events** on one endpoint (family app). Stripe now suggests "thin" events for new
  integrations; snapshot is still fully supported and carries the signed object, so we
  don't need an extra API call per event.

## Webhook endpoint setup (Dashboard → Workbench → Webhooks)

- URL `https://spiritofsanta.com/api/webhooks/stripe` (exact canonical host; Stripe doesn't
  follow redirects). "Your account". Payload: **Snapshot**. **API version: `2026-09-30.endive`**.
  Our account's default is still `2022-11-15` (seen in a real event 2026-11-05). The fields
  we use exist in both, but match the endpoint to the SDK so types are exact.
- Events (10): `payment_intent.succeeded`, `.payment_failed`, `.canceled`;
  `checkout.session.completed`, `.expired`, `.async_payment_succeeded`, `.async_payment_failed`;
  `charge.refunded`; `charge.dispute.created`, `.closed`.
- `whsec_` secret → family `STRIPE_WEBHOOK_SECRET` (Vercel). Test and live endpoints have
  different secrets. Roll secrets periodically (Stripe allows 24 h overlap).
- Local: Stripe can't reach localhost, so without the Stripe CLI NO webhook arrives locally.
  `scripts/e2e/stripe-webhook.ts` signs events itself with the local secret; `--real-stripe` makes
  a real test payment and replays Stripe's actual event.
  With the CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, and put the
  `whsec_` it prints in apps/family/.env.local `STRIPE_WEBHOOK_SECRET` (it's per machine).
  **Installed 2026-11-06** (`winget install Stripe.StripeCli`; exe under
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Stripe.StripeCli_*\stripe.exe`, new shells have `stripe`).
  No `stripe login` needed: set `STRIPE_API_KEY` (= the TEST secret key) in that shell. This CLI
  version REQUIRES `--events`; use the same 10 as the production endpoint:
  `stripe listen --forward-to localhost:3000/api/webhooks/stripe --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,charge.refunded,charge.dispute.created,charge.dispute.closed`
  `stripe listen --print-secret` prints the machine's `whsec_` (stable; already in .env.local).

## Fulfil on the return page too (added 2026-11-06)

Stripe's guidance: fulfil from the webhook AND when the customer lands back on your site, with
fulfilment idempotent. We do this: the registration / tip / donation status pages call
`fulfilPaidPaymentIntent(piId)` (@repo/payments/checkout, `fulfil.ts`) when Stripe's API says the
session is `payment_status: "paid"`. It retrieves the PaymentIntent with OUR key (so same mode,
nothing from the browser trusted) and runs the same `onPaymentIntentSucceeded` as the webhook;
the unique PaymentIntent id makes whichever runs second a no-op. Found when a local $5 registration
stayed "awaiting" (no webhook locally). Refunds/disputes are still webhook-only.
Test: `scripts/e2e/stripe-return-fulfil.ts` (real test PaymentIntent with `pm_card_visa`).

## SDK facts we rely on (v23)

- `Stripe.webhooks.constructEvent(rawBody, header, secret, tolerance?)` is **static**: it
  needs no API key. Default tolerance 300 s. **v23: passing `0` DISABLES the age check**
  (it used to mean "default"). Never pass 0.
- 23.0.1 rejects whitespace-only webhook secrets (security fix): why we pinned ≥ 23.0.1.
- Pinned API version per SDK major; don't override `apiVersion` (types would lie).
- `payment_method_types` was removed from PaymentIntent/Checkout create params in this API
  version: use dynamic payment methods (`automatic_payment_methods`).
- To keep DELAYED methods (bank debits, vouchers) off a Checkout Session, use
  `excluded_payment_method_types`. EVERY checkout that credits Christmas Magic (tips, donation links, bonus,
  pay-up) does this via `DELAYED_PAYMENT_METHODS` (@repo/payments/checkout): money must arrive before the Dec 25 close.
- `Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp? })` signs test events.
- `Stripe.Event` is a union discriminated by `type`, so `event.data.object` is typed per case.
- Field shapes: `charge.payment_intent` and `dispute.payment_intent` are `string | PaymentIntent | null`;
  `session.payment_link` is `string | PaymentLink | null` (we handle both via `idOf`).

## Webhook behaviour (Stripe side)

- Retries for up to 3 days in live mode (sandbox: 3 tries over a few hours) on non-2xx.
- **No ordering guarantee** and possible duplicates, even two different event ids for one
  object. Dedupe by event id AND make the effect idempotent per object.
- Respond fast with 2xx. Our handler is a few DB ops (< 1 s), so it's processed inline. If
  it ever gets slow, ack first and process in a queue.
- Optional extra layer: allow only Stripe's IPs (docs.stripe.com/ips) via Vercel Firewall.

## Our design (packages/payments)

1. `handleStripeWebhook(request)`: 1 MiB body cap (413) → `request.text()` (raw!) →
   signature (400) → `processStripeEvent`.
2. `processStripeEvent`: livemode must match key type (`sk_live_`/`sk_test_`), else ignored →
   `StripeEvent` log by `event.id` (processed/ignored = duplicate, failed = retry) →
   `dispatchStripeEvent` → log outcome. Unique-index race (11000) = "duplicate_race", 200.
3. Handlers (`handlers.ts`):
   - `payment_intent.succeeded`: parse `sos_*` metadata (else ignored "not_ours") → money checks
     (USD, full amount, tip/bonus within MIN/MAX_TIP_CENTS) → in ONE transaction: kid exists
     in that family and isn't archived; deed matches kid; insert ledger `earn_tip`/`earn_bonus`
     (`idempotencyKey: stripe:pi:<id>`) + `$inc` kid balance + confirm deed (outcome "paid") +
     upsert `Payment` (credited). Problems → `Payment` "review" + `needsReview`, no points.
     Donation / pay-up → `Payment` "held" (Phase 5/6 picks them up).
   - `payment_failed`/`canceled`: record, never downgrade a succeeded payment.
   - `charge.refunded`: `$max refundedCents`, flag. `charge.dispute.*`: record status, flag;
     a late non-final status never overwrites won/lost.
   - `checkout.session.completed`/`async_payment_succeeded` (paid): deactivate the pay-later
     Payment Link (`paymentLinks.update(id, { active: false })`). **Never credits** (the PI
     event does), so there's no double-credit path.
4. Metadata contract (`metadata.ts`): `sos_v`="1", `sos_purpose` tip|bonus|donation|payup,
   `sos_kid_id`, `sos_family_id`, `sos_deed_id?`, `sos_wish_list_item_id` (payup), `sos_zip?`
   (donation). Create with `buildPaymentMetadata()`. Only our secret key can set PI metadata
   (a payer with the client_secret can't), but we still re-check against the DB.
   For Payment Links/Checkout put it in BOTH `metadata` and `payment_intent_data.metadata`.

## Review fixes (independent review, 2026-11-05)

- **Refund/dispute before its payment is recorded** (succeeded event still retrying): we used
  to log it "ignored" and lose it. Now `onMissingPayment` retrieves the PI from Stripe: ours →
  `RetryLaterError` (500, Stripe redelivers after the payment lands); unknown/not ours → ignored.
- **payment_failed racing payment_succeeded** on the same PI: the "never downgrade" guard is now
  in the write's filter (`status: trusted({ $ne: "succeeded" })`, upsert → 11000 = already
  succeeded). The credit handler re-runs its transaction once on 11000 instead of assuming
  "done". `processStripeEvent` no longer treats any 11000 as success; it returns 500.
- Hardening: pay-later link deactivation only for per-deed tips (reusable donation links stay
  active); `Payment.currency` accepts any ISO code so a non-USD payment lands in review.
- E2E now 26 checks (incl. both races and an early refund on a real test payment). The script
  retries once on ECONNRESET (keep-alive race in the test client, not the app).

## When building payment creation (Phase 4–5)

- Server-only creation: compute amount server-side, enforce MIN/MAX_TIP_CENTS, attach
  `buildPaymentMetadata(...)`, pass an `idempotencyKey` request option on create.
- Show "All tips are final" before payment. Never trust client amounts or kid ids without
  checking the session/QR token.
- **Production needs `syncIndexes`** (autoIndex is off in prod): the unique indexes on
  `transactions.idempotencyKey`, `payments.stripePaymentIntentId` and `stripeevents.eventId`
  are what make duplicates impossible.

## Embedded Checkout (saved 2026-11-05, docs.stripe.com/checkout/embedded/quickstart + installed types)

Used for the $5 child registration (Phase 4 slice 2b): Stripe's form inside our page, no redirect.

- **Server** (secret key only): `stripe.checkout.sessions.create({ ui_mode: "embedded_page", mode: "payment",
  line_items, return_url: ".../return?session_id={CHECKOUT_SESSION_ID}", metadata, payment_intent_data: { metadata } })`
  → pass `session.client_secret` to the page. NOTE: in API `2026-09-30.endive` the value is **`embedded_page`**
  (older docs/training data say `"embedded"`). UiMode = `elements | embedded_page | form | hosted_page`.
- **Client**: `@stripe/stripe-js` **10.2.1** + `@stripe/react-stripe-js` **7.0.1** (peer: stripe-js >=10 <11, React <20):
  `const stripePromise = loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)` (module scope; loads from js.stripe.com,
  required for PCI) → `<EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>` (or
  `fetchClientSecret: () => Promise<string>`) `<EmbeddedCheckout /></EmbeddedCheckoutProvider>`.
  Vanilla JS equivalent: `stripe.createEmbeddedCheckoutPage({ fetchClientSecret })`. Don't nest in another iframe.
- **Return page**: `stripe.checkout.sessions.retrieve(session_id)` server-side: `status` `complete` (paid) or `open`
  (failed/cancelled: show checkout again). Show status only; FULFIL from the webhook (`payment_intent.succeeded`,
  our rule: credit/fulfil only there).
- Test cards: 4242 4242 4242 4242 (ok), 4000 0025 0000 3155 (3-D Secure), 4000 0000 0000 9995 (declined).
- **`expires_at`** (Checkout Session): must be at least 30 minutes and STRICTLY LESS than 24 hours after creation
  (exactly +24 h is refused: "must be less than 24 hours from Checkout Session creation", verified 2026-11-05). We
  cap tips at 23.5 h and at the deed's expiry / season close (`packages/deeds/src/public.ts`).

## Payment Links for pay-later texts (checked in installed SDK types, 2026-11-06)

`paymentLinks.create({ line_items: [{ quantity: 1, price_data: { currency, unit_amount, product_data } }],
metadata, payment_intent_data: { metadata }, restrictions: { completed_sessions: { limit: 1 } },
inactive_message, after_completion: { type: "hosted_confirmation", hosted_confirmation: { custom_message } } })`.
- `price_data` inline is supported (no separate Price object needed).
- PaymentLink `metadata` is AUTOMATICALLY copied to the Checkout Sessions it creates (SDK doc comment), so
  `onCheckoutSessionPaid` sees `sos_*` on the session; `payment_intent_data.metadata` reaches the PI (credits).
- Links never expire by themselves: our daily cron sets `active: false` after `expiresAt` (and the webhook
  deactivates a single-use link once paid). `inactive_message` is what a visitor sees on a dead link.
