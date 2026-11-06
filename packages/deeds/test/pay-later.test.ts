// No-database tests for the pay-later rules registered with the carriers (src/pay-later.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { payLaterExpiry, payLaterText } from "../src/pay-later.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 10, 12);

test("link lasts 7 days, but ends at least a day before the deed/season deadline", () => {
  assert.equal(payLaterExpiry(NOW, NOW + 14 * DAY)!.getTime(), NOW + 7 * DAY); // normal deed (14-day QR)
  assert.equal(payLaterExpiry(NOW, NOW + 5 * DAY)!.getTime(), NOW + 4 * DAY); // deadline in 5 days → 4
  assert.equal(payLaterExpiry(NOW, NOW + 2 * DAY)!.getTime(), NOW + DAY); // exactly one full day left
  assert.equal(payLaterExpiry(NOW, NOW + 2 * DAY - 1), null); // less than a full day: no link
});

test("the text is the registered wording (exactly one link, STOP/HELP, rates)", () => {
  const t = payLaterText("https://buy.stripe.com/abc123", 7);
  assert.equal(t, "Spirit O Santa: here is your link to pay the tip for the good deed you received. It expires in 7 days: https://buy.stripe.com/abc123 Msg & data rates may apply. Reply STOP to opt out, HELP for help");
  assert.match(payLaterText("https://buy.stripe.com/x", 1), /expires in 1 day:/);
});
