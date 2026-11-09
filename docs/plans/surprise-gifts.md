# Surprise gifts (parent-added, shown to the child as a wrapped gift)

## Context
Owner request 2026-11-08: a parent can put a **surprise** gift (a real store item) on their child's wish list. The
child sees only a **generic wrapped-gift picture**: no photo, name, store or link. The parent can either **fully
fund it now by card** or let it fill with Christmas Magic through the normal flow.

Owner decisions (2026-11-08):
- **Card price:** $1.50 per point, using the same flow as pay-up. Wording should be subtle, not loud, and go in the
  terms plus a small muted line: the rate helps pay for administration, good shipping rates and gift wrapping,
  costs parents already pay, just not all at once.
- **Gift limit:** a surprise counts toward the child's gift limit, and no Magic is needed to add it (the kid's
  "≥1 Magic to add" rule is skipped).
- **Fill order:** normal oldest-first Magic order, **but a card-funded surprise is guaranteed.** The pay-up webhook
  already credits the money and fills that gift first (`allocateForKid(..., firstId)`), so it becomes fully funded,
  secured and non-removable.

## Approach: reuse the wish-list engine and the pay-up payment, add one flag

### 1. Data + engine (`packages/db`, `packages/wishlists`)
- **`WishListItem`** (`packages/db/src/models/wish-list-item.ts`): add `surprise: { type: Boolean, default: false }`.
  No migration is needed; old rows read as false.
- **`engine.ts`:**
  - Move the body of `addToList` into an internal `addItem(parent, kidId, itemId, now, { surprise })`. Keep all its
    existing checks: owner, season `open`, registered kid, active item, approved store, stock > 0, cap via
    `CAP_STATUSES` (surprises count toward the cap).
  - `surprise: true` skips the `MIN_CENTIPOINTS_TO_ADD_ITEM` check.
  - Duplicate rules:
    - The **kid's** duplicate check ignores surprise rows. Otherwise "already on your list" would give the surprise
      away, and the kid may add the same item.
    - The **parent's** surprise check refuses an item that's already on the list in any form.
  - Export `addSurprise(parent, kidId, itemId, now?)`. Removal is unchanged: `removeFromList` (PIN page), active
    rows only.
- **`catalog.ts` `kidWishList`:**
  - Add `surprise` to `WishRow`.
  - New option `{ reveal?: boolean }`, default **false**. When false, surprise rows are masked **on the server**
    (name, photo, store and itemId removed; `viewable:false`; `surprise:true`), so the real item never reaches the
    child's browser or the RSC payload.
  - `onList` leaves out surprise items.
  - Pure helper `maskSurprise(row)` with unit tests.
  - Only parent-PIN pages pass `reveal: true`: the remove page and the new surprise pages.

### 2. Parent pages (PIN, `apps/family`)
- **Entry point:** a small "Add a surprise (parents)" link on the kid page goes to `/kids/[id]/surprise`.
  `requireUnlockedPage`, so it asks for the PIN, and the path is added to `safeNext` in `apps/family/lib/parent.ts`.
- **`/kids/[id]/surprise`** shows:
  - this child's surprise gifts, revealed: photo, name, progress, status;
  - a **"Fund it now — $X"** button per active, unfinished gift;
  - the existing remove link;
  - a gift search that reuses `browseGifts` and the existing gift-card grid from the kid gift browser.
- **`/kids/[id]/surprise/[itemId]`** is the detail page, reusing `giftDetail`. Its **"Add as a surprise"** server
  action re-checks `unlockedParentOrNull()`, uses Zod ids and calls `addSurprise`.
- **Fund now** reuses `startPayUp` (`packages/families/src/payup.ts`) with one change to its window: it allows
  `payUpWindow()` as today, **or** `giftWindow().open` **when the gift is a surprise**. In the open season,
  `endsAt = min(giftWindow().closeAt, now + MAX_CHECKOUT_MS)`.
  - The checkout is otherwise the same: metadata `sos_purpose:"payup"` with the gift id, `paymentMethodConfig()` +
    `CHECKOUT_EXCLUDED_METHODS`, generic product name.
  - The **webhook, ledger, allocation and receipts need no changes.**
  - Return goes to `/kids/[id]/surprise/return`, which reuses `payUpStatus` and needs only a signed-in parent (like
    the pay-up return page).
  - The embedded checkout reuses the `payup-form.tsx` pattern.
- **Pricing note:**
  - A small muted line under the Fund-now button, e.g. "Christmas Magic is $1.50 each: it helps cover handling,
    good shipping rates and gift wrapping, costs you'd pay anyway, spread out."
  - One sentence in the Terms (messages for `LegalSections`, en + es).
  - Add the Terms sentence to `docs/legal/lawyer-packet.md`.

### 3. What the child sees (no PIN)
- **Wish-list card** (`kids/[id]/wish-list-card.tsx`): a surprise row shows `ILLUSTRATIONS.giftBox` (the swappable
  wrapped-gift file), the title "A surprise!", no link and no store. The progress bar label reads "Surprise gift:
  X of Y".
- **Celebration dialog** (`components/celebration.tsx` via `kids/[id]/page.tsx`): for a surprise, "Your surprise
  gift is all yours!" with no item name.
- **Gift detail and browser:** no "already on your list" for a surprise item, since `onList` excludes it.

### 4. Other places
- **"On its way" email to the parent** (`fulfilment.ts` + `packages/email/messages`): the subject is generic ("A
  surprise gift for {kid} is on its way"); the body names the item, because it's the parent's inbox.
- **Admin fulfilment:** a "Surprise" badge on the row, so the team knows to keep it wrapped. The store app is
  unchanged (it never sees child data).
- **Parent data export:** shows the real names (parent, PIN) plus a surprise flag.

## Files
- **db and engine:** `packages/db/src/models/wish-list-item.ts`, `packages/wishlists/src/{engine,catalog}.ts` (+ test).
- **Payment:** `packages/families/src/payup.ts`.
- **Family app:**
  - `apps/family/app/[locale]/kids/[id]/{page.tsx,wish-list-card.tsx}`
  - new `kids/[id]/surprise/**`
  - `kids/[id]/wishlist/[wid]/remove/page.tsx` (`reveal:true`)
  - `apps/family/lib/parent.ts` (`safeNext`)
  - `apps/family/components/celebration.tsx`
  - `messages/{en,es}.json`
- **Elsewhere:** `packages/wishlists/src/fulfilment.ts` (email + admin badge), `packages/email/messages`,
  `apps/admin/app/[locale]/fulfilment/page.tsx`, `packages/families/src/data-export.ts`.
- **Docs:** `docs/CODEMAP.md`, `docs/illustrations.md`, `docs/legal/lawyer-packet.md`, plus the memory files
  (reuse-map, project-status).

## Verification
- **Unit tests:** `maskSurprise`; `addItem` rules (surprise skips the Magic rule, counts toward the cap,
  duplicate rules); `startPayUp` window for surprise vs. non-surprise.
- **Engine E2E:** extend `scripts/e2e/wishlist-engine.ts` with addSurprise on a 0-Magic kid, cap reached, and
  ledger invariants (`ledgerProblems`).
- **New browser E2E `scripts/e2e/browser-family-surprise.ts`** (Edge, *_dev only). It checks:
  - the parent PIN is needed;
  - the parent adds a surprise;
  - the kid page **HTML contains neither the item name nor the photo URL**, and shows the wrapped gift;
  - the gift detail page doesn't say "on your list";
  - Fund now opens Stripe;
  - a signed test webhook makes the gift fully funded;
  - the celebration shows no name;
  - non-surprise pay-up before the freeze is still refused;
  - no browser errors.
- **Re-run:** `browser-family-payup.ts`, `browser-family-wishlist.ts`, `browser-qr-page.ts`, and the page audit with
  the new pages added.
- **Full suite:** `npx turbo run lint check-types test build`.
- **Finish:** review the diff, commit on a branch, merge to main and push, update CODEMAP and memory.
