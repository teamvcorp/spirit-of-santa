/**
 * What OTHER packages need to create payments: the Stripe client and the metadata builder.
 * SERVER-ONLY. (Webhook internals stay in webhook.ts / handlers.ts.)
 */
import "server-only";

/**
 * Payment methods whose money arrives DAYS later (bank debits, vouchers, customer balance). Every checkout
 * that credits a kid's Christmas Magic (tips, donation links, bonus, pay-up) EXCLUDES them: one started on
 * Dec 24 could settle after Christmas, when the magic can't fill a gift any more and is wiped on Jan 1
 * (year-round slices 3+4; first found for pay-up, review 2026-11-06). Cards and wallets stay allowed.
 * Stripe SDK v23 Checkout has no payment_method_types allow-list, so we exclude (docs/vendor/stripe.md).
 */
/**
 * Stripe PAYMENT LINKS (pay-later texts) take an ALLOW-list instead (payment_method_types; no exclude option).
 * "card" covers Apple Pay / Google Pay wallets too. Same reason as DELAYED_PAYMENT_METHODS.
 */
export const INSTANT_PAYMENT_LINK_METHODS = ["card"] as const;
export const DELAYED_PAYMENT_METHODS = ["us_bank_account", "acss_debit", "customer_balance", "sepa_debit", "bacs_debit", "au_becs_debit", "nz_bank_account", "payto", "boleto", "oxxo", "konbini", "multibanco"] as const;
export { getStripe } from "./client.ts";
export { buildPaymentMetadata } from "./metadata.ts";
export { fulfilPaidPaymentIntent } from "./fulfil.ts";
export { checkoutReturnStatus, creditReturnState, type ReturnResult } from "./return-status.ts";
