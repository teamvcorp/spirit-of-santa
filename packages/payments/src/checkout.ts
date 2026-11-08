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
/**
 * Methods the OWNER chose not to offer on any checkout (2026-11-08: "keep bank, no crypto"). Link's instant "Bank"
 * stays. Payment links (pay-later) are card-only anyway (INSTANT_PAYMENT_LINK_METHODS).
 */
export const NOT_OFFERED_PAYMENT_METHODS = ["crypto"] as const;
/** The full exclude list for every checkout that credits Christmas Magic: delayed methods + not offered. */
export const CHECKOUT_EXCLUDED_METHODS = [...DELAYED_PAYMENT_METHODS, ...NOT_OFFERED_PAYMENT_METHODS] as const;

/**
 * Spirit of Santa's OWN Stripe "payment method configuration" (owner 2026-11-08). The Stripe account (VA Corp) is
 * shared with other products, so instead of changing the account's Default we point our checkouts at a group named
 * "Spirit of Santa": the Default's methods but LINK OFF (Link can't drop its crypto option on its own, and the
 * owner chose no crypto). Set STRIPE_PAYMENT_METHOD_CONFIG to that group's pmc_… id per environment (test id
 * locally + Preview, live id in Production). Not a secret. Unset or MALFORMED → the account Default (today's
 * behaviour). CAREFUL: a well-formed but WRONG id (the test id with live keys, or a group deleted in the Dashboard)
 * passes this check and Stripe then refuses EVERY checkout. Spread into every checkout.sessions.create.
 *
 * Which checkout excludes what: tips, donation links, bonus, pay-up → CHECKOUT_EXCLUDED_METHODS (delayed + crypto);
 * registration and /donate → NOT_OFFERED_PAYMENT_METHODS (crypto only). Pay-later Payment Links → card-only allow-list.
 */
export function paymentMethodConfig(): { payment_method_configuration?: string } {
  const id = process.env.STRIPE_PAYMENT_METHOD_CONFIG?.trim();
  return id && /^pmc_[A-Za-z0-9]{8,64}$/.test(id) ? { payment_method_configuration: id } : {};
}
export { getStripe } from "./client.ts";
export { buildPaymentMetadata } from "./metadata.ts";
export { fulfilPaidPaymentIntent } from "./fulfil.ts";
export { checkoutReturnStatus, creditReturnState, type ReturnResult } from "./return-status.ts";
