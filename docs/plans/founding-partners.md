# Founding partners: partner fee + Christmas Magic donor badge

Status: SPEC, not built. Written 2026-11-18 from owner decisions made while drafting the retailer
letters (`outreach/retailers/`). Read `docs/CODEMAP.md` first; follow the slice workflow
(plan, build, E2E, commit, review, fix commit, update CODEMAP + memory).

## What the owner has promised stores (the letters say this)

1. A founding partner **lists 50 top-selling items each year**. Sales, not donations: every funded
   gift is bought from the store at the agreed discount. (Already built: store catalogue, 50-item
   limit, `Store.discountBps`, payouts.)
2. A founding partner **pays a one-time partner fee of $50,000**. REQUIRED to become a partner.
   It is a business payment, NOT a donation.
3. A founding partner is **strongly advised to give $50,000 or more to build Christmas Magic**.
   That gift becomes Christmas Magic for children (every child, or chosen ZIP codes). Stores that
   give get a **"Christmas Magic donor" badge beside their name**, and nothing else: no better
   placement, no extra promotion.

The app must make all three true. Today only item 1 exists.

## Hard rules (do not break)

- The partner fee is never recorded as a donation, never gets a donation receipt, never enters the
  donation pool, and never becomes Christmas Magic.
- The donor badge is recognition only. It must NOT change item order, search rank, placement,
  or anything a child or parent sees about the store's items. Add a test that proves ordering is
  identical with and without the badge.
- Never trust client-sent amounts or point values: recompute server-side (existing convention).
- All Stripe calls server-side. Do not change the Stripe account configuration (products, payment
  methods, webhooks) without asking the owner first; reads are fine.
- Zod on every route/action input; TypeScript strict; Server Actions over client fetch.
- User-facing copy says "Christmas Magic", never "points". EN + ES strings for everything new.
- No refunds (existing owner decision) unless the owner says otherwise for the partner fee.

## Slice 1: charity details on receipts (small, do first; the site is live)

`PlatformSettings.charity` (legalName, EIN, address) feeds every donation receipt. The owner
confirmed on 2026-11-18 that the charity is:

- Legal name: The Von Der Becke Academy Corp
- EIN: 46-1005883 (IRS determination letter dated 2014-05-23)
- Address: 100 Village Circle Way, #325, Durham, NC 27713

Work:
- No schema change expected. Verify the admin `/settings` screen accepts and saves these values,
  and that receipt emails (`packages/email/messages/{en,es}.json`, key with "a program of {orgName}")
  render them. The owner types the values in admin; do not seed them into code.
- Search the repo for the string "Edynsgate" in user-facing copy and docs. Older notes named it as
  the charity; it is a project of the Academy, not a separate charity. Fix copy; leave history notes.
- Receipts already issued keep their stored `issuer` (do not rewrite them).

Done when: a test donation in dev produces a receipt showing the Academy's name, EIN and address.

## Slice 2: partner fee (required to be a partner)

Model (suggested; adjust to existing patterns in `packages/db/src/models/store.ts`):

```
Store.partnerFee: {
  status: "not_required" | "due" | "paid" | "waived",   // default "not_required" for existing stores
  amountCents: number,          // set by admin, e.g. 5_000_000; integer, validated
  invoiceNo: string,            // human-readable, unique
  paidAt: Date, paidVia: "check" | "ach" | "wire" | "card",
  reference: string,            // check number / bank reference, admin-entered
  recordedByUserId, waivedReason
}
```

Behaviour:
- Admin sets "partner fee required" on a store (with amount) when inviting/approving it.
  A store with `partnerFee.status === "due"` can set up its profile and items (same as pending
  stores today) but is NOT visible to families until the fee is `paid` or `waived`.
  Enforce this in the same place store visibility is decided today (families see only approved stores).
- Admin screen: mark paid (date, method, reference), or waive (reason required). Both write an
  AuditLog entry. Admin-only, MFA-protected like other money actions.
- Invoice: generate a simple invoice/receipt-of-payment email and admin-viewable page for the fee.
  Wording: "Founding partner fee". It must NOT say tax-deductible, must NOT use the donation
  receipt template, and must NOT include the "no goods or services were provided" sentence.
- Payment method: default to recording an offline payment (check/ACH/wire), matching how stores
  are paid today (no Stripe Connect). Do not add card payment for the fee unless the owner asks:
  card fees on $50,000 are large.
- Store owner dashboard: show fee status (Due / Paid on DATE / Waived) and the invoice.
- Reporting: partner-fee income appears separately from donations in the admin analytics.

Open questions for the owner (ask before building):
- Is the fee per store brand once ever, or per season? (Letters say "one-time".)
- Can admin waive or reduce it for small local stores, or is $50,000 fixed for everyone?
  The store app is also used by local stores in the beta; decide whether they are "partners" at all.
- Refundable if the store is later rejected or leaves?

## Slice 3: Christmas Magic donor badge

Today `/donate` gifts are anonymous community/corporate gifts pooled to Dec 1 and are not linked
to a Store. Limits: `MIN_DONATION_CENTS` 500, `MAX_DONATION_CENTS` 5_000_000 ($50,000) in
`packages/lib/src/limits.ts`. The letters say "$50,000 or more", so a single payment cannot exceed
the current cap.

Work:
- Link a donation to a store: optional `Payment.storeId` (indexed) set ONLY server-side. Suggested
  flow: a signed, single-use "donate as STORE" link generated from the store owner dashboard or by
  admin (reuse the existing action-token pattern). Never accept a storeId from the client form.
- Admin can also record an offline Christmas Magic gift (check/ACH) for a store. Decide with the
  owner whether offline gifts enter the pool the same way and get the same receipt.
- Badge rule (server-side, one helper, one source of truth): a store shows the badge for a season
  when its succeeded, non-refunded, non-disputed donations for that season total at least the
  threshold. Threshold lives in `PlatformSettings` (admin-set; owner's figure is $50,000). No
  hard-coded amount.
- Display: small "Christmas Magic donor" badge beside the store name wherever the store name is
  shown to families (store page, item cards if the store name appears). Accessible name + tooltip,
  EN/ES. Reuse `@repo/ui` components; check the reuse map before writing new ones.
- The badge does not alter sorting, filtering, featured slots or item visibility (see hard rules).
- **$50,000 is a recommendation, not a cap (owner, 2026-11-18).** A store may give more. Today
  `MAX_DONATION_CENTS` stops any single gift above $50,000, so that limit must not apply to
  store-linked gifts. Do this safely:
  - Keep a server-side upper bound for card payments as a fraud/typo guard (Stripe itself rejects a
    single charge of $1,000,000 or more). Put the new limit in `packages/lib/src/limits.ts` as its own
    named constant for store-linked gifts; do not just delete the check.
  - Show "$50,000 recommended" as the suggested amount on the store gift form, with a free amount field.
  - Large gifts are better paid by check, ACH or wire and recorded by admin (card fees on $50,000+
    are large and banks often decline card payments that size). Support that path first.
  - Leave the public `/donate` cap for anonymous gifts as it is unless the owner asks to change it.
- Privacy: the public page still shows only the season total, never per-donor or per-ZIP amounts.
  The badge shows that a store gave, never how much.

Receipts (owner decision 2026-11-18: tax treatment is the donor's concern, and the letters tell
stores to ask their own tax advisor):
- Keep the existing donation receipt for these gifts. Do not add tax advice to the app.
- Flag for the owner, do not decide in code: the receipt currently states that no goods or services
  were provided. A badge is plain recognition, so that statement stays accurate ONLY while the
  badge is the sole thing a donor store receives. If featured placement is ever added for donors,
  the receipt wording must be revisited first.

Open questions for the owner:
- Does `donationFeeBps` (the admin margin) apply to a partner store's Christmas Magic gift? The
  Costco grant draft promises "the full grant becomes Christmas Magic"; that needs a way to mark a
  gift as fee-free (per-payment override set by admin), or the promise cannot be kept.
- Does the badge last one season or permanently?
- DECIDED (owner, 2026-11-18): the badge is earned only at **$50,000 and above** in Christmas Magic
  gifts. Smaller gifts are welcome but earn no badge. Keep the threshold as an admin setting in
  `PlatformSettings` whose value the owner sets to $50,000; the letters now say the same.
- Should the badge show on the store's own dashboard and on emails, or family pages only?

## Slice 4: donor acknowledgment checkbox (owner request 2026-11-18)

Before a donation receipt can ever be issued, the donor must tick a box that states the purpose of
the gift and that they receive nothing in return. Build this with slice 1 if convenient: it applies
to every `/donate` gift (community, corporate and store-linked), not only partner stores.

Draft wording (owner to approve; EN + ES):

> I understand this donation goes to Spirit of Santa, a program of {orgName}, to be used as
> Christmas Magic that provides presents to children. I will not receive any goods or services in
> return for this donation.

Behaviour:
- Required, unticked by default, shown on the donation form BEFORE payment. The pay button stays
  disabled until it is ticked, and the server action rejects the request if it is missing (never
  rely on the client check alone; validate with Zod).
- Record it on the Payment: `donorAck: { version, acceptedAt }`. Keep the wording under a version
  constant (same pattern as `SMS_CONSENT_VERSION` / `PARENT_CONSENT_VERSION`); bump the version
  whenever the text changes.
- Receipts: only send a donation receipt when the Payment has a `donorAck`. Gifts made before this
  ships have none: do not block or re-ask for those; keep today's `receiptsFromDay` behaviour for them.
- Offline gifts recorded by admin (check/ACH): admin must tick "donor signed the acknowledgment"
  and may attach or reference the signed copy.
- Accessible: real `<input type="checkbox">` with a `<label>`, error message announced if missing.

Owner must confirm before the text ships:
- "{orgName}" comes from `PlatformSettings.charity.legalName`. If that is empty the checkbox text
  cannot render correctly, so donations should not be offered until charity details are set.
- The text does not say "100%" or "directly": `donationFeeBps` can keep a share for running costs.
  If the owner wants "100% goes to children", the fee must be 0 for those gifts.
- The donor badge (slice 3) is recognition, not a good or service, so the sentence stays true while
  the badge is the only thing a donor store gets.

## Tests (each slice)

- Unit: badge helper (threshold edges, refunded/disputed excluded, season boundaries); partner-fee
  state transitions; visibility gate.
- E2E in the existing browser-test style: store with fee due is hidden from families, becomes
  visible when marked paid; donation via signed store link flips the badge at the threshold;
  item ordering is byte-identical with and without the badge.
- Security review per slice: admin-only actions, no storeId/amount from the client, audit log
  entries, rate limits on the new token route.

## Not in scope

- Card payment for the partner fee, Stripe Connect, refunds.
- Any tax wording beyond what exists.
- Changes to how the Dec 1 pool is split.

## Owner answers (2026-11-18, asked before building)

- Who pays the partner fee: **admin decides per store**. Status `not_required` (default, local beta
  stores) or `due` with an admin-set amount; admin may waive with a required reason.
- Refund: **never refunded**. The fee invoice says "non-refundable".
- Admin margin (`donationFeeBps`) on store gifts: normal cut by default; **admin can mark a single
  gift fee-free** (per-payment override) so promises like "the full grant becomes Christmas Magic" hold.
- Badge length: **that season only** (resets Jan 1).
- Offline (check/ACH/wire) store gift recorded by admin: **same as a card gift**: joins the Dec 1
  pool, counts toward the badge, gets the normal donation receipt once admin ticks "donor signed the
  acknowledgment".
- Badge shows on: **family pages** and the **admin store list**. Not on the store's own dashboard,
  not in emails.
- Donor checkbox wording: **approved as written** (EN). ES drafted by Claude; owner reviews.
- Charity details: owner says they are **already entered** in admin Settings.

## Review notes (slice 4, 2026-11-18)
- A gift without the acknowledgment after the rule day is flagged needsReview (no receipt), never silently dropped.
- Slice 3's admin offline gift MUST set Payment.donorAck when admin ticks "donor signed the acknowledgment",
  or ensureDonationReceipt will refuse its receipt.

## Slice P: public partners page (owner request 2026-11-18)
A family-site page of every company we invited, from the SAME Store collection (no second list). Owner answers:
- Statuses: invited → "Pending"; pending (signed up, in review or partner fee due) → "Processing";
  approved → "Approved"; declined our invitation → a little Grinch; stores WE rejected or suspended are hidden.
  Admin gets a "mark declined" action on invited stores (new status or field; audited).
- North Star on top of any status when the store holds the season donor badge (slice 3's helper, one source of truth).
- Logos: the store uploads its own logo in the store app (= permission); until then the tile shows the company name.
  Declined companies: name only + Grinch, NEVER a logo.
- Tap a tile: signed-in parent with one registered kid → that kid's gift list filtered to this store; several kids →
  "Whose wish list?" choice; anyone else → sign up, with the line "to see what wonders await".
