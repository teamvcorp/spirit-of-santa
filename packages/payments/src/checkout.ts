/**
 * What OTHER packages need to create payments: the Stripe client and the metadata builder.
 * SERVER-ONLY. (Webhook internals stay in webhook.ts / handlers.ts.)
 */
import "server-only";
export { getStripe } from "./client.ts";
export { buildPaymentMetadata } from "./metadata.ts";
export { fulfilPaidPaymentIntent } from "./fulfil.ts";
export { checkoutReturnStatus, creditReturnState, type ReturnResult } from "./return-status.ts";
