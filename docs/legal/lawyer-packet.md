# Spirit of Santa — items for legal review

Prepared 2026-11-07 for Spirit of Santa's lawyer. Everything below is built and live in the code; the wording on
the public pages is marked **DRAFT** until you approve it. Each item says what the site does today, where people
see it, and the question for you.

Current text versions (shown at the top of each page; bump after any change you request):
- Privacy policy: `2026-11-07b-draft` (spiritofsanta.com/privacy)
- Parental consent + children's privacy notice: `2026-11-07b-draft` (accepted at sign-up)
- Terms of service: `2026-11-07-draft` (spiritofsanta.com/terms)
- Store discount and guarantee agreement: `2026-11-07` (accepted by stores at sign-up)
- Text-message consent: `sms-2026-11-06b` (registered with the carriers)

## 1. Children's privacy (COPPA)

1. **Verifiable parental consent.** A parent agrees to the children's privacy notice and pays a $5 registration
   fee per child by card; the card payment is our consent method. *Is a card charge an acceptable method?*
2. **What we collect about children:** first name, birth year (not birth date), a display name shown publicly
   (e.g. "M."), their good deeds and wish list. No photos of children, no child accounts, no child email.
3. **Deletion.** A parent can delete a child or the whole family at any time; children's data is deleted at once.
4. **Re-consent.** Families who agreed to an earlier version of the notice will be asked to agree again before
   continuing (being built next). *Is asking at next sign-in enough, or must we contact them?*

## 2. Keeping a parent's details after they delete their account (new: longer than before)

When a family deletes its account while a paid gift is still on its way, the parent can choose "deliver it first".
We then delete the children's data at once, and keep only the parent's email, family name and delivery address
(encrypted) until the gift is delivered, **at the latest January 31 after that Christmas**.

Because gifts are now held by stores until December (see 3), a deletion in March can mean keeping that parent
data for **up to about 11 months**. *Is that retention acceptable, and is the privacy wording clear enough?*

## 3. Money taken now for a gift delivered in December

- Gifts are funded all year. A fully funded gift is **secured**: it can't be removed, its Christmas Magic is spent,
  and the store holds it until it ships in December.
- Giving (tips, donation links, bonus magic) **closes December 1** so every gift can arrive by Christmas. Parents
  can then pay what a gift still misses for 3 days after community donations are shared out.
- Gifts still unfinished after that **drop off**, and the Christmas Magic already on them goes to Spirit of Santa.
- Christmas Magic has no cash value and **resets to zero every January 1**; unspent magic stays with Spirit of Santa.
- **All payments are final** (no refunds except where the law or card networks require). A chargeback does not
  take magic back.

*Questions: are these disclosures (terms "The season and gifts", "Christmas Magic", "Payments") sufficient for
money collected months before delivery? Any gift-card / stored-value or consumer-protection rules that apply to
Christmas Magic or to forfeiting it on Jan 1 / at the drop-off?*

## 4. Donations and tax receipts

- Community donations (spiritofsanta.com/donate) are pooled and shared equally among registered children on
  December 1; an admin-set platform fee is shown before giving.
- Every donation gets an emailed receipt. Receipts name the receiving charity (Edynsgate: legal name and EIN still
  to be confirmed by the owner). *Is the receipt wording right for a tax deduction, given donors receive no goods?*

## 5. Text messages (pay-later links)

One text per request with a payment link, after explicit opt-in (never pre-ticked); STOP/HELP honoured; number
and consent time kept up to 13 months. Toll-free verification is in progress with Twilio.
*Any TCPA concerns with the consent wording on /text-messages?*

## 6. Store agreement

Stores accept the agreement at sign-up. New in this version: held items are kept for the child and shipped to
Spirit of Santa by December 10; billing uses the discount in force when Spirit of Santa receives the item; items
and prices can change only January 1 – March 31 (stock any time); last season's items are copied each January 1.
*Is the guarantee ("available at the listed price for the season, or an equal or better substitute") enforceable
for stock held up to 11 months?*

## Where to read the exact wording

- Family site: /privacy, /terms, /text-messages, the sign-up consent step, /parent/delete-account.
- Store site: the sign-up agreement step.
- Source files (for the developer): `apps/family/messages/en.json` and `es.json` (Privacy, Terms, DeleteAccount),
  `apps/store/messages/*.json` (StoreAgreement), versions in `packages/lib/src/family.ts` and `packages/lib/src/store.ts`.
