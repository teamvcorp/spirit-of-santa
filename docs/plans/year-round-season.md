# Year-round season — plan (2026-11-07)

Owner decisions: app open ALL YEAR (Jan 1 – Dec 25), CLOSED Dec 26 – 31; Dec 1 freeze kept; Jan 1 reset kept; gifts LOCK
when secured and are HELD, stores ship in December; STORES add/change merchandise only Jan 1 – Mar 31 (catalogue fixed
after that).

Defaults taken in auto-run mode (owner may overrule; also in memory season-year-round):
1. Fully funded = secured: can't be removed (ends the 30-day undo window). Gifts needing a substitute lock too (money
   secured; Spirit of Santa arranges a substitute).
2. Pay-up last day Dec 8 (ship-by Dec 10); December funding continues to Dec 25, labelled "may arrive after Christmas".
3. Catalogue = store Q1 window (owner rule); no rollover. Stock edits must be compare-and-set (reservations race).
4. Deliver-then-delete with held gifts: keep contact until delivered, max Jan 31 after that Christmas (LAWYER item).
5. Santa's list year starts Jan 1.  6. Community donations pooled to Dec 1, one split (unchanged).  7. Freeze capped Dec 3.

MUST-FIX from critique (before/with building):
- Shipping decided PER GIFT: last season's held gifts are always shippable (never "held" for a year after Dec 25).
- Lock-at-full-funding and the December ship window ship TOGETHER (else stores are told to ship in March).
- Held gifts: outside the window set ONLY setAsideNotifiedAt (never readyNotifiedAt), so the Dec 1 "ship now" email fires.
- Reset gate must never strand the family site: reset runs FIRST on Jan 1; marks done when only admin-flagged kids
  remain (needsAttention, loud); admin "finish & open season" button; "no SeasonReset docs at all" = done.
- Donation split gated on the freeze DATE (a force-freeze must not split early).
- Closed page gates only kid area, /k, /d, /donate, parent/payup, parent/bonus, register; rights pages stay open
  (delete-account, our-data, notifications, address, unsubscribe, text-messages, privacy, terms).
- Webhook: 503 only for point-crediting payments while resetting.
- Pay-up off-by-one; freeze/shipBy validation; Spanish "octubre" sweep; season-reset E2E "offseason" check renamed.

Slices: 1 calendar core + reset gate (+admin button, migration seed, webhook) · 2 closed page · 3+4 TOGETHER lock at full
funding + December ship window (per-gift) · 5 pay-up/late label · 6 deliver-then-delete deadline · 7 store Q1 catalogue
+ stock CAS · 8 docs/legal/lawyer packet.

Full design and both critiques below.

---

# Year-round season: design plan

Nothing was edited and no `.env*` files were read. The plan checks and builds on the four reader reports. I re-read `packages/lib/src/season.ts`, `packages/payments/src/season-end.ts`, `apps/family/app/api/cron/money/route.ts`, `packages/wishlists/src/{engine,payup,rules,fulfilment}.ts`, `packages/families/src/erase.ts` and `packages/payments/src/handlers.ts`.

## 0. The calendar

- **Year Y:**
  - **Jan 1 – Nov 30:** open. Kids earn magic and change wish lists.
  - **Dec 1 – Dec 25:** frozen. Lists are fixed, pay-ups run, gifts ship.
  - **Dec 26 – Dec 31:** closed.
- **Jan 1:** the reset runs, then season Y+1 opens on the same day.
- **Season year:** `getSeasonYear` (season.ts:88) stays the calendar year in Chicago time. Every `seasonYear` stamp stays correct and needs no change.

## 1. SEASON_CALENDAR, phases and admin date changes

**`packages/lib/src/season.ts:17` (new calendar):**
- `open {1,1}`, `freeze {12,1}`, `close {12,26}`, `reset {1,1}`.
- New: `shipBy {12,10}`, the stores' last ship day.
- `storeWindowStart/End` are unchanged here; slice 6 below covers the store window.
- **What "close" means:** keep it as the FIRST closed day. Every reader already cuts off at `startOfDayInZone(dates.close)`:
  - giftWindow, stores/season.ts:174
  - deed QR expiry, deeds.ts:55 and public.ts:160
  - payUpWindow, payup.ts:34
  - closeUnfunded, payup.ts:111
  - split blockedReason, split.ts:176

  So Dec 25 becomes usable with no change to any comparison. The admin interface shows "last day = close − 1" (see §5).

**Phases (season.ts:26):** `"resetting" | "open" | "frozen" | "closed"`.
- Rename `offseason` to `resetting`. It means "from Jan 1 until `SeasonReset(year-1)` is done".
- Under the default calendar it is the only gap before open. Every reader that treats "not open/frozen" as shut keeps working unchanged: fundingSeason (engine.ts:50), addToWishList and removeFromWishList (engine.ts:190 and :339), recordDeed (deeds.ts:45), giftWindow, donationWindow (community.ts:34) and split (split.ts:176).
- The only reader of the name today is season-end.ts:40.

**`resolveSeason` (season.ts:151):** add a field `prevResetDone: boolean` to the overrides.

```ts
const phase = today >= dates.close ? "closed"
  : !o.prevResetDone ? "resetting"
  : today >= dates.freeze ? "frozen" : "open";
```

- `getSeasonState` (stores/season.ts:45) adds one indexed lookup, `SeasonReset.exists({seasonYear: year-1, status: "done"})`, alongside the Season document it already loads.
- **Admin force-freeze:** the rule at season.ts:162 is unchanged and now usable Jan 1 – Nov 30. Update the comment at stores/season.ts:123.
- `getSeasonPhase` (season.ts:66) is used only by tests. Map it as: k ≥ 1226 closed, k ≥ 1201 frozen, otherwise open. The default calendar can't see the reset gate.

**Admin date changes (season.ts:172 and :187–209; stores/season.ts:147):**
- Open is fixed to Jan 1, so remove `openDate` from the editable inputs. Keep the database field but ignore it, because old Season documents may still have it.
- Freeze and close for the CURRENT season stay editable until the current freeze date. The rule becomes `datesLocked = today >= dates.freeze`.
- Next year's dates are editable at any time.
- Validation:
  - freeze must be between Nov 1 and Dec 10, and in the future;
  - close must be between Dec 26 and Dec 31 (Christmas Day stays in the season), and after freeze;
  - error types: `invalidDate | wrongYear | order | freezeInPast | closeRange | locked`. `openInPast` is removed.
- Admin interface:
  - remove the openDate field from season-forms.tsx:97 and the Zod schema in actions.ts:52;
  - page.tsx:62 shows the current year as editable until the freeze;
  - the close field is labelled "First closed day (default Dec 26)", with the help text "the season's last day is the day before".

**Migration script, `scripts/migrate/season-calendar-2026-11.ts`:**
- Run it once per database. It is dry-run by default and needs `--apply` to write.
- It clears `openDate` and any `closeDate` of Dec 25 or earlier on Season documents from 2026 onward.
- It seeds `SeasonReset{seasonYear: 2025, status: "done", note: "pre-calendar"}`. Without this seed, the gate would put today's dev database (2026) into `resetting`.

## 2. Gifts: lock when secured, held, shipped in December

**Lock (owner: "lock when secured, magic spent"):**
- "Secured" means fully funded: the money is in and a stock unit is reserved (engine.ts:125).
- Remove `ITEM_LOCK_DAYS` (limits.ts:28) and the `lockAt()` function (rules.ts:20).
- `isRemovable` (rules.ts:29) becomes `status === "active"`. A fully funded gift can no longer be removed, and because the check is on status rather than a date, a late lock job leaves no gap.
- `lockFundedItems` (engine.ts:449): `byAge` becomes "every fully_funded gift". It is the same daily job and the same spend-at-lock code (lockGiftsInSession, engine.ts:406), so it is idempotent and its ledger keys don't change.
- The freeze-date branch at :451 stays as a safety net.
- Fix the comment at :430–438. "Store may now ship" becomes "held until the ship window".
- Do NOT lock inside allocateForKid. That would put spend and ledger writes inside every credit transaction.
- **Owner confirmation:** parents can no longer undo a fully funded gift. Today they have a 30-day undo window.

**Ship window:** one pure helper in season.ts, also carried on SeasonState.

```ts
shipping: { open: today >= dates.freeze && today < dates.close, from: dates.freeze, by: shipBy(year) }
```

- It is derived from the freeze date, so admin date changes apply and no new setting is needed.
- **fulfilment.ts:132, storeOrders:** `locked && shipping.open` goes to `ready`. Otherwise `locked` or `fully_funded` goes to `setAside` (shown to stores as "held for December").
- **fulfilment.ts:142, orderCounts:** same rule. Outside the window, `ready` is 0 and `setAside` counts fully_funded plus locked.
- **fulfilment.ts:158, markShipped:** add `if (!season.shipping.open) return {ok:false, error:"notYet"}` on the server, so a crafted request can't ship early. Shipping after Dec 10 is still allowed until close (a late gift is better than none). The interface shows "late: may arrive after Christmas".
- **fulfilment.ts:225, sendStoreDigests query:**
  - Outside the window: `{status: {$in: ["fully_funded", "locked"]}, setAsideNotifiedAt: null}`. Everything is reported as "set aside / held".
  - Inside the window: the existing `$or` (fully_funded with `setAsideNotifiedAt` null, locked with `readyNotifiedAt` null).
  - The first digest on Dec 1 therefore announces every held gift once as "ship now, by {shipBy}".
  - The idempotency hash at :263 already includes status. Add `|ship` / `|hold` to it, so a gift reported as held in March is not treated as the same content as the same gift reported as "ship now" in December.
  - The 5000-row cap needs a store-level loop check: on Dec 1, roughly 9 months of gifts arrive together. The cap is a query limit, so the remaining gifts go out the next day. Add a `remaining` count so the cron reports it.
- **email `storeOrders` (packages/email/messages/en|es.json:74):** add a `{shipBy}` value, passed at fulfilment.ts:259.
- **Family view:**
  - `kidWishList` (catalog.ts:222) drops `lockAt` and adds `shipping.from`.
  - wish-list-card.tsx:57 replaces "Locks in on {date}" with "Secured: ships in December, in time for Christmas" for fully_funded and locked gifts.
- **Payout:** keep "the discount in force on the day the gift is received" (fulfilment.ts:491). Document this in the store terms.

**Risks flagged as backlog items (no code in this change):**
- An admin action "store can't supply this any more", which sets needsSubstitute on a LOCKED gift. Today arrangeSubstitute (fulfilment.ts:473) only clears the flag.
- suspendStore (stores/src/admin.ts:142) does nothing to the store's held gifts.
- An optional Nov 1 email asking stores to confirm they still hold the gifts.

## 3. Jan 1 reset, Dec 25/26 close and what users see

**Reset (season-end.ts):**
- It runs while `phase === "resetting"`. The reason `notOffseason` becomes `notResetTime`.
- `ended = year − 1`, and the code at :41 stays the same.
- Update the header comment at :5–9. The rule is now "nothing earns while resetting, and Dec 26–31 is closed".
- The rest needs no change: per-kid compare-and-set, the ledger key per (season, kid), the `done` check only once no kid has points, and resuming the next day.
- When `done` is written (line 112), the next request sees `open`. The reset itself opens the new season.

**Earning during `resetting` is closed for every path:**
- tips, bonus, deeds and donations go through giftWindow, recordDeed and donationWindow;
- funding goes through fundingSeason, so `sweepAllocations` is a no-op;
- list changes are closed.
- **One hole is the Stripe webhook.** `creditPaymentIntent` (handlers.ts:106) stamps `getSeasonYear(now)` (:113) and credits the balance, which the reset would then wipe.
- Fix: when `phase === "resetting"`, return a retryable error (HTTP 503) before writing anything, so Stripe retries later. Stripe retries for up to 3 days, and the reset takes about 2 hours.
- `writeNotPaid` (:285) is harmless and can stay.

**Cron order on Jan 1 (route.ts):**
1. split (blocked)
2. payLater
3. lock (locks any leftover fully_funded gifts of year Y−1 and spends their magic)
4. sweep (no-op)
5. closeUnfunded (`lastClosed = year−1` in resetting, payup.ts:111: correct)
6. … digests …
7. runSeasonReset

No reordering is needed, because the gate removes the sweep-before-reset race. Update the comments at :9–17 and :63–64.

**Vercel Hobby plan:**
- The cron runs at 08:00 UTC (02:00 CST), sometimes up to an hour late. Families see "Starting the new season" from 00:00 to about 02:00–03:00 on Jan 1.
- If the reset fails, the app stays in `resetting`, so the failure is loud rather than silently wrong. The cron already returns 500.
- Add an admin "Run season end now" button on /season. It needs `requireRole("admin")`, Zod validation and an audit log entry, and calls the same `runSeasonReset`.

**Dec 26 close:**
- On Dec 26, closeUnfunded fires with `phase closed` and `lastClosed = year`.
- The split reports `seasonOver`.
- Dec 25 is now payable: giftWindow and the deed QR expiry run until Dec 26 00:00.

**What users see during `closed` (Dec 26–31) and `resetting`:**
- **Family app:** a family layout gate shows a "Closed for Christmas, back January 1" page on the kid and parent areas.
- **Still available during the closure:**
  - sign-in;
  - legal pages;
  - **/account privacy (review and delete).** COPPA parent rights must stay usable at all times;
  - the Stripe webhook;
  - the cron.
- **Store app:** fully usable. Orders shows late or unshipped gifts.
- **Admin app:** fully usable.
- **Santa's list:** `santaListYear` (season.ts:239) is left unchanged. Dec 26–31 can't be voted on. Owner question: should the list start move to Jan 1? If yes, change :239–245 and votes.test.ts:5–11.

## 4. Other touchpoints

- **Pay-up:**
  - Today it closes at close − 7 days (limits.ts:38). That would be Dec 19, after the Dec 10 ship-by.
  - Recommendation: close pay-up at `shipBy − PAY_UP_DAYS_BEFORE_SHIP_BY (2)`, so the last pay day is Dec 8. The gift then locks at the Dec 9 cron and the store ships it by Dec 10.
  - Change in payup.ts:34–40. The pay-up reminder (digest.ts:150) follows automatically.
  - Owner question: December tips and donations still fund gifts until Dec 25, so those gifts arrive late. Options are to keep that (recommended, with the family label "may arrive after Christmas") or to stop funding at Dec 10.
- **Freeze reminder** (digest.ts:150): no change.
- **Donation split** (split.ts:176): no change.
- **Community donations:**
  - Pooled from Jan 1 to Nov 30 and split once on Dec 1. Logic unchanged.
  - Owner check: is one split after 11 months of pooling acceptable?
- **Store item window** (season.ts:22, :76; items.ts:49, :129, :165): owner decision needed. The new season's catalog is EMPTY on Jan 1.
  - Recommendation: the Jan 1 job copies the previous season's active, in-stock Items into year Y+1 before the reset is marked done. It keeps the price and inventory snapshots, and stores review them from Jan 1 to Mar 31.
  - Alternative: open the store window for year Y+1 from Dec 1, with items stamped `year+1`.
  - Separate slice.
- **Deliver-then-delete** (erase.ts:144): today's cap is min(45 days, Jan 31), so a deletion requested in March means the gifts go to Spirit of Santa.
  - Recommendation: if the family has AWAITING_DELIVERY gifts, the deadline is Jan 31 after that Christmas (Chicago time). Otherwise use 45 days.
  - Fix the year calculation, which uses UTC instead of Chicago time.
  - Lawyer item: parent contact and address could now be kept for up to about 11 months. Only parent data is involved; children's data is still deleted straight away.
- **Delivery addresses** (delivery.ts:20, :43): kept until December. Mention this on the privacy page.
- **Receipts:** unchanged. `seasonYear` is still the calendar year.
- **Admin dashboard** (apps/admin/app/[locale]/page.tsx:66): uses the new phase key.

## 5. Copy and documents (English and Spanish together)

**Family app (`apps/family/messages/{en,es}.json`):**
- 221: deeds seasonClosed becomes "…again from January 1".
- 270 and 300: "January 1 to November 30".
- 283–289 and 299:
  - remove `lockOn`;
  - add `secured`, "Secured, ships in December";
  - removeErrors.locked becomes "secured, can't be removed";
  - fully funded removal error.
- 333, 357, 386, 506: "back January 1".
- 476: community donations "all year until December 1".
- New key: `closedPage`, with three variants: closed / resetting / back Jan 1.

**Store app (`apps/store/messages/{en,es}.json`):**
- 113: ordersAlert.
- 244: readyIntro becomes "ship by {shipBy}".
- 248: setAsideIntro becomes "held for December, ship Dec 1–10".
- New error `notYet`.
- 94, 109, 173: window text, depending on the store-window decision.

**Email (`packages/email/messages/{en,es}.json:74`):** storeOrders with `{shipBy}`. Check the assertions in render.test.ts.

**Admin app (`apps/admin/messages/{en,es}.json`):**
- 149 and 327: `offseason` becomes `resetting`, "Starting the new season (Jan 1 reset)".
- 160: datesLine becomes "Open all year · freezes {freeze} · last day {lastDay}".
- 168 and 172: window help text.
- 182–197: date-lock wording and errors (freezeInPast, closeRange).
- New key: "Run season end now".

**Legal pages (version bump, then re-consent through the existing consent version flow):**
- **Terms** (family en.json:555–563): add that the service is unavailable Dec 26–31, that a gift is secured at full funding and can't be removed, and that gifts ship in December.
- **Privacy** (:69 and the retention section): addresses are kept until December delivery, and deliver-then-delete now has a longer limit.
- **Store terms:** stock is held until December, the ship-by date, and the discount at receipt.
- Add all three to the lawyer packet.

**Project docs:**
- CLAUDE.md:20 becomes "Open all year Jan 1 | Freeze Dec 1 | Ship by Dec 10 | Last day Dec 25 | Closed Dec 26–31 | Reset + reopen Jan 1 | lock at full funding, held, ship Dec".
- docs/CODEMAP.md: 268–273, 337, 375, 388, 423, 428, 488–495, 512, plus a decision note "Season model 2026-11-07".
- SpiritOfSanta.md: 7, 184, 221, 237, 283–294, 308–314, 344.
- docs/PRODUCTION-SETUP.md: 115–117, plus the migration step.
- Also update the memory files.

## 6. Tests

**Unit tests:**
- **packages/lib/test/season.test.ts:**
  - Boundaries: Dec 25 23:59 CST is frozen; Dec 26 00:00 CST (2027-12-26T06:00Z) is closed; Jan 1 is `resetting` without `prevResetDone` and `open` with it; Jun 1 is open.
  - forceFrozen in June gives frozen; on Dec 28 it stays closed.
  - `datesLocked` from the freeze date.
  - New validateSeasonDates cases.
  - `defaultSeasonDates(2030)` = 2030-01-01 / 12-01 / 12-26.
  - `shipping` window edges.
- **packages/wishlists/test/rules.test.ts:8–21:** isRemovable is true only for `active`; delete the lockAt tests.
- **New `deletionDeadline` tests:** held gifts give Jan 31 Chicago time; none gives 45 days.

**End-to-end tests (inject `now` or set Season dates):**
- **scripts/e2e/season-reset.ts:**
  - refused in open, closed and frozen with `notResetTime`;
  - in `resetting`: zeroes balances, marks done, and the phase becomes open;
  - the webhook returns 503 during resetting;
  - sweep is a no-op while resetting;
  - idempotent when run twice.
- **wishlist-engine.ts step 8 (:122–139):** a fully funded gift locks at the next run whatever its age, can't be removed straight away, and is spent once.
- **browser-store-orders.ts:**
  - before the window, a locked gift shows as "held" and markShipped returns `notYet`;
  - in the window it shows as "ready" with the digest date, and the Dec 1 digest is sent once.
- **browser-family-payup.ts:42, :110, :165, :172:** the new close-date and ship-by arithmetic.
- **browser-admin-season.ts:61, :95–118:** remove the open field; freeze and close can be edited until the freeze.
- **New `browser-family-closed.ts`:** the closed page shows, and /account delete still works.
- **Headers only:** browser-family-deeds, bonus, donate, paylater, qr-page, community-donate and wishlist.

## Slice order

Each slice follows the usual workflow: plan, build, E2E, commit, review, fix, CODEMAP.

1. **Calendar core plus reset gate.** Covers season.ts, getSeasonState, season-end.ts, the webhook 503, cron comments, the migration script, admin date rules, forms and copy, and the unit and season-reset tests. It must ship together: a calendar change alone would stop the reset from ever running.
2. **Closed and resetting family page.** Layout gate, closed-page copy, keep /account and legal pages working, E2E.
3. **Lock at full funding.** rules.ts, limits.ts, engine comments, family card and copy, tests.
4. **December ship window.** SeasonState.shipping, storeOrders, orderCounts, markShipped `notYet`, the digest query split, email, store copy, E2E.
5. **Pay-up tied to ship-by,** plus the late-funding label.
6. **Deliver-then-delete deadline for held gifts.**
7. **Store catalog for Jan 1.** Rollover or an earlier window, after the owner decides.
8. **Docs, legal version bump, lawyer packet,** plus backlog items for the substitute-on-locked-gift action and the Nov 1 store check-in.

## Slice 5 (REPLACED 2026-11-07 by owner): giving closes Dec 1, pay-up Dec 1-3, then unfinished gifts drop off

Owner: "gifts cannot arrive after Christmas, keep the disclosure small" → chose CLOSE GIVING AT THE FREEZE (Dec 1),
pay-up Dec 1-3 after the donation split, unfinished gifts drop off right when pay-up ends. Replaces default 2
(pay-up to Dec 8 + "may arrive after Christmas" label): no late label is needed because nothing can fill late.

- `giftWindow()` (tips, donation links, bonus, pay-later links): open phase only; `closeAt` = START of the freeze
  date, so every checkout and pay-later link already caps at it. A force-freeze also stops giving (emergency).
- QR page: thanking a deed (no money) stays possible while frozen; the tip form is replaced by one small line.
- Pure `payUpPeriod(dates)` in @repo/lib/season: opens at the freeze, closes PAY_UP_DAYS (3) days later
  (last pay day Dec 3). `payUpWindow` uses it; `PAY_UP_CLOSES_DAYS_BEFORE_CLOSE` removed.
- `closeUnfunded` drops a season's unfinished gifts once its pay-up period has ended (Dec 4), not at Dec 26.
- Copy (en+es), small: one line where people give ("Giving closes {date} so every gift arrives by Christmas"),
  pay-up alert/page/reminder say gifts drop off after {last pay day}; cutoff reminder mentions giving closes.
- E2E: payup (window arithmetic), deeds/qr/donate/bonus (frozen = no money), wishlist close timing.

## Owner questions before building

1. Can parents no longer undo a fully funded gift, which ends today's 30-day undo window? (Recommended: yes.)
2. Pay-up's last day Dec 8, so gifts can still ship by Dec 10? And should December funding keep running until Dec 25, with those gifts arriving late?
3. Should the Jan 1 catalog come from rolling over last season's items, or from a store window that opens in December?
4. Should deliver-then-delete keep the parent's contact details until Jan 31 when gifts are held? (Needs lawyer review.)
5. Should the Santa's list year start Jan 1 instead of Dec 26?
6. Is one donation split after 11 months of pooling acceptable?
7. Is a closed page from Jan 1 00:00 to about 02:00–03:00 acceptable while the reset runs?
---

# Critiques

**Money and lifecycle review: concrete problems**

1. **Locked gifts get stuck after Dec 25 (critical).** The plan's `shipping.open = today >= dates.freeze && today < dates.close` uses the current season's dates, not the gift's `seasonYear`.
   - From Dec 26 the phase is closed, so `shipping.open` is false, and `markShipped` returns `notYet` for every season-Y gift not yet shipped. On Jan 1 the dates become season Y+1's, so those gifts read as "held" until Dec 1 Y+1. That is a whole year late, with the magic already spent.
   - A gift funded on Dec 25 also hits this. The plan keeps tips and pay-ups running until Dec 25. That gift locks at the Dec 26 cron (`lockFundedItems`'s frozen branch includes `closed`, engine.ts:452) and can never be shipped.
   - The digest query has the same fault: outside the window it reports last season's locked gifts as "held".
   - Fix: decide per gift. Allow shipping when `gift.seasonYear < season.year || (seasonYear === year && today >= freeze)`. Use this one rule in storeOrders, orderCounts, markShipped and the digest query. Add an E2E test: a gift locked Dec 26 can still be shipped on Jan 5.

2. **A June force-freeze would run the donation split (high).** `blockedReason` (split.ts:176–181) runs whenever `phase === "frozen"`, and the force-freeze switch sets that phase (season.ts:162). The plan opens force-freeze to Jan–Nov, so freezing in June would split the pooled donations early. After that, the daily runs keep splitting new donations while the switch stays on. This breaks the owner's "pooled to Dec 1" rule.
   - Fix: gate the split on the freeze DATE (`now >= startOfDayInZone(dates.freeze)`), as `payUpWindow` and `lockFundedItems` already do.
   - Check every other reader of `phase === "frozen"` (giftWindow, fundingSeason) for the same mistake. Those two are harmless.

3. **The reset gate can close the family app indefinitely (high).**
   - season-end.ts:62–64 deliberately skips kids that already have a reset row ("left for an admin"). But step 3 (:110) only marks the reset done when NO kid has points. So one kid credited after their batch (a webhook racing the 503 check, an admin fix, any future credit path) means `done` never gets written. Today that is invisible. With `prevResetDone` gating the phase, the whole family app stays in `resetting` for good.
   - **Timing:** the cron runs once a day and `runSeasonReset` is the 11th job in a 300-second function (route.ts:80). If it times out, the rest waits for the Jan 2 run, about 32 hours of closed app. That is not the "about 2 hours" the plan says.
   - Fix:
     1. On the reset date, run the reset straight after split and payLater, before lock, digests and receipts.
     2. Mark the reset done when every kid with points already has a reset row. Report those kids as `needsAttention` and fail the cron loudly.
     3. Make the admin "Run season end now" button part of slice 1, not optional.
     4. Do the webhook's phase check inside the credit transaction.

4. **Stores can overwrite stock that kids have already reserved (high, new because of the overlap).** Stores now edit items Jan 1–Mar 31 while kids are funding gifts. `setInventory` and `updateItem` write an absolute number (`$set: { inventory }`, items.ts:219, :247), while `allocateForKid` decrements stock with `$inc: -1` (engine.ts:142).
   - Example: a store's form shows 5, a kid's gift reserves one (5 → 4), then the store saves the form with 5. That is one unit oversold, and the gift is locked with its magic spent.
   - Fix: add a compare-and-set on the inventory value the form read, or have the store edit "on-hand" stock and keep reservations separate.

5. **Ship-by and pay-up arithmetic can produce an empty window (medium).** Freeze can be set as late as Dec 10, but `shipBy` is fixed at Dec 10.
   - Pay-up would then run from Dec 10 to `shipBy − 2` = Dec 8: an empty window.
   - The shipping window would be one day.
   - Fix: require `freeze <= shipBy − PAY_UP_DAYS_BEFORE_SHIP_BY − 1`, or let `shipBy` be overridden per season and validate it with the other dates.

6. **Gifts lock without a reserved unit (medium).** `allocateForKid` sets `needsSubstitute` when stock is 0 (engine.ts:150). Under "lock at full funding", that gift is locked and its magic spent even though no present is secured. That contradicts the owner's own definition of secured.
   - Either lock only gifts with `inventoryReserved: true`, or have the owner accept this explicitly.
   - Either way, the "store can't supply this any more" admin action is needed in this change, not left as backlog: gifts are now held for up to 11 months.

7. **Chargebacks on held gifts (medium).** The no-refund policy keeps points (handlers.ts:346, :373). With gifts held for months, a chargeback almost always arrives before the gift ships, and nothing stops a disputed gift from shipping.
   - Add an admin "hold shipment" flag, or show disputed payments next to the gift in the store-orders admin view.

8. **Webhook 503 covers too much (low).** A blanket 503 during `resetting` also delays registration payments ($5 consent) and receipts. Return 503 only for purposes that credit a kid's points.
   - Stripe stops retrying after 3 days. If the reset is stuck (#3), those credits are lost without anyone noticing. Alert on this.

9. **Payout after a price change (low).** `markReceived` pays from the snapshot `costCentipoints` (fulfilment.ts:497). A store that changes its price in February is paid on the old price for gifts funded in January. The store terms must say "the price at the time the gift was added".

10. **Migration (low).** If the dev database already has `SeasonReset{2025}` with status `running`, an `$setOnInsert` seed leaves it running, and the gate shuts dev down. The seed has to set `status: "done"` explicitly, after a dry-run report.

**What holds up**
- Keeping `close` as the first closed day works. Every cutoff already uses `startOfDayInZone(close)`, so Dec 25 becomes usable without touching any comparison.
- Ledger keys survive retries and two runs at once: `spend:<id>`, `forfeit:<id>`, `season-reset:<season>:<kid>`. Nothing is spent or forfeited twice across the Dec 25 to Jan 1 boundary.
- `closeUnfunded`'s `lastClosed` arithmetic (payup.ts:111) is correct in `closed`, `resetting` and `open`.
- `fundingSeason`, `recordDeed` and `giftWindow` treat any phase other than open or frozen as shut, so renaming `offseason` to `resetting` shuts every earning path except the webhook, which the plan already covers.
- The reset only zeroes `availableCentipoints`, and escrow is gone by then (spent at lock or forfeited Dec 26). Nothing is double-counted.
- Escrow-to-spend accounting is unchanged when `ITEM_LOCK_DAYS` is removed. The `isRemovable` check on status alone leaves no gap if the lock job runs late.
- The store payout amount is fixed when the gift is received, so a later discount change never rewrites what is owed.
- `seasonYear` stays the calendar year, so receipts and ledger stamps need no change.

Files read: `C:\Users\maste\projects\turboSanta\packages\lib\src\season.ts`, `packages\stores\src\season.ts`, `packages\payments\src\season-end.ts`, `packages\payments\src\split.ts`, `packages\payments\src\handlers.ts`, `packages\wishlists\src\{engine,payup,rules,fulfilment}.ts`, `packages\stores\src\items.ts`, `packages\families\src\digest.ts`, `apps\family\app\api\cron\money\route.ts`.

=========== CRITIC ===========

**Users and operations review of the year-round season plan: 11 concrete problems, then what holds up**

1. **Old-season locked gifts can never be shipped after Christmas.** `markShipped` (fulfilment.ts:158) would check `season.shipping.open`, and that window comes from the *current* year's freeze date.
   - From Dec 26 the window is closed. A gift locked in December and not yet shipped gets `notYet`.
   - From Jan 1, `shipping` is worked out from the next December, so the gift is stuck for 11 months. Its magic is already spent and the family never gets it.
   - `storeOrders` (:129–134) also puts that gift in "held for December", which is the wrong message.
   - The plan says "Store app fully usable, Orders shows late gifts", but the code it proposes contradicts that.
   - **Fix:** the ship rule should be `gift.seasonYear < year || shipping.open`. Use a separate `tooLate` label for late gifts and keep `notYet` for gifts before the window. Add an E2E test on Dec 27 and Jan 2.

2. **Slice order 3 then 4 makes stores ship early for real.** Once slice 3 is live, every fully funded gift locks at the next cron. `sendStoreDigests` (:258) then sorts it as `ready` ("ship now"), and `markShipped` accepts it, in November or March.
   - **Fix:** ship slices 3 and 4 together, or slice 4 first.

3. **The held-gift digest can quietly skip the Dec 1 "ship now" email.** :257–258 sort gifts by status, and :288 sets `readyNotifiedAt` on every locked gift.
   - If the "outside the window" branch keeps that sorting, locked gifts get `readyNotifiedAt` in March. The Dec 1 query (`locked, readyNotifiedAt:null`) then finds nothing, and no store is told to ship.
   - **Fix:** outside the window, put locked gifts in `setAside` and set only `setAsideNotifiedAt`. Add a test where a gift is locked in March, the Dec 1 digest says "ship now" exactly once, and a second run sends nothing.

4. **The reset gate can take the whole family site down.** `runSeasonReset` marks itself `done` only when no kid has points (season-end.ts:111). It also skips kids that already have a reset row (:82). One kid with a reset row and a non-zero balance (bad data or a race) means it never reaches `done`.
   - Today that only fails the cron. With the gate, every family stays on "resetting" (closed) with no end date.
   - **Fix:** give admins a "finish anyway / open season" override (audited), or mark the reset `done` once the skipped kids are logged for an admin. Add an alert if the reset is still running at 06:00 on Jan 1.

5. **A fresh production database stays closed until the first cron.** With no `SeasonReset(year-1)` record, the phase is `resetting`, so a launch day (for example mid-2027) starts closed until 02:00 the next day.
   - The migration seed is described as run "once per database" but is missing from the PRODUCTION-SETUP deploy steps.
   - **Fix:** add it to PRODUCTION-SETUP, or treat "no SeasonReset documents at all" as reset done.
   - Also, scripts/e2e/season-reset.ts:34 checks `"offseason"`. Rename it, or it silently stops guarding.

6. **The closed-page allowlist names a route that doesn't exist.** There is no `/account`. The rights pages live inside the area the gate closes:
   - `parent/delete-account`
   - `parent/our-data` (the new, uncommitted COPPA page)
   - `parent/notifications` (opt-out)
   - Also outside the parent area: `/unsubscribe`, `/text-messages` (SMS STOP/consent), `/privacy` and `/terms`.

   Parents also lose `parent/address` while late December gifts are still being delivered.
   - **Fix:** gate only the kid area (`/kids`, `/k`), `/d`, `/donate`, `parent/payup`, `parent/bonus` and `register`. Keep everything else open. The new browser-family-closed test should cover our-data and delete-account.

7. **Pay-up dates are off by one.** In payup.ts:38–40, `closesAt` is the *start* of the first day payments are blocked, and `lastPayDay = closesAt − 1ms`. So `shipBy(Dec 10) − 2 days` gives a last pay day of **Dec 7**, not Dec 8 as the plan says.
   - **Fix:** pick one meaning and test it. Use constant 1 if the last pay day should be Dec 8: payments close Dec 9 00:00, the gift locks at the Dec 9 02:00 cron, and the store gets about one day to ship by Dec 10.
   - The payUpReminder (digest.ts:162) uses `closesAt` with `REMINDER_DAYS_BEFORE = 3`, so it goes out Dec 4 or 5. Check the date shown in that email.

8. **Some admin date choices break the rest of the calendar.**
   - Freeze is allowed up to Dec 10, but `shipBy` is fixed at Dec 10. A Dec 10 freeze gives a one-day ship window and a pay-up window that ends before it opens.
   - **Fix:** cap freeze at around Dec 3, or set `shipBy = max(Dec 10, freeze + N)`.
   - Freeze can now be changed until the freeze date itself. The cutoff reminder may already have gone out with the old date (`cutoffSentYear` set, digest.ts:157, 199), so families act on a wrong date.
   - **Fix:** require new freeze ≥ today + REMINDER_DAYS_BEFORE + 1, or clear `cutoffSentYear` when the freeze date changes.

9. **The family card copy promises something the system can't guarantee.** "Secured: ships in December, in time for Christmas" (slice 3) would also show on gifts funded Dec 11–25, which the plan itself allows to arrive late. The "may arrive after Christmas" label only comes in slice 5.
   - **Fix:** in slice 3 use "Secured, ships in December". Add the late label based on `fullyFundedAt > shipBy`.

10. **The Stripe 503 is too broad, and it doesn't cover Dec 26–31.**
    - During `resetting` it also blocks registration fees and donations to Spirit of Santa. These don't add to kids' balances and are safe to process, so limit the 503 to payments that credit points.
    - A card payment that completes Dec 25 23:59 but whose webhook arrives Dec 26 or later is credited (handlers.ts:113) and then wiped on Jan 1. This is not new, but now it's "closed", not "off-season". Add it to the docs and the reset test.

11. **Spanish copy beyond the plan's line list.** es.json:222 and :358 hard-code "desde el 1 de octubre", and :290 `lockOn` is "Se asegura el {date}". Check every "octubre" in all four apps' es.json files, not only the listed line numbers.

**Current data.** No real families or stores yet; the live season starts Oct 2027. On the dev database, gifts already locked and announced as "ready" under the 30-day rule will flip to "held" once slice 4 lands. Leave these as shipped/test data, or exempt gifts with `readyNotifiedAt` set before the deploy, so E2E fixtures don't fail.

**What holds up (checked against the code)**
- Keeping `close` as the first closed day works. Every reader cuts off at `startOfDayInZone(close)`, so Dec 25 becomes usable without changing any comparison.
- The Dec 26 00:00 CST = 06:00Z boundary is correct.
- The cron at 08:00 UTC is 02:00 CST in December and January (no daylight saving then).
- `closeUnfunded`'s `lastClosed` logic is correct in both `closed` and `resetting`.
- The cron order (lock, then sweep, then close, then digests, then reset) needs no reordering once the gate exists.
- The `|ship`/`|hold` addition to the digest hash is the right way to keep it idempotent.
- Calendar-year `seasonYear` stamps stay valid.
- The fake Jan 2 date in the season-reset E2E still works under the gate, because `SeasonReset(ended)` doesn't exist yet, so the phase is `resetting`.
- The cutoff reminder (digest.ts:155) needs no change.
- The admin "Run season end now" button is a good recovery path; make it a target of fix 4.