/**
 * @repo/db: Mongoose connection + models shared by family, store and admin. SERVER-ONLY.
 *
 *   import { connectDb, Kid, Transaction } from "@repo/db";
 *
 * Importing connect.ts first applies the global safety settings (sanitizeFilter,
 * strictQuery) before any model is compiled.
 */
import "server-only";

export { connectDb, trusted, withTransaction, type DbSession } from "./connect.ts";
export { toObjectId } from "./object-id.ts";
export { User, USER_STATUSES, type UserDoc } from "./models/user.ts";
export { Family, type FamilyDoc } from "./models/family.ts";
export { Kid, type KidDoc } from "./models/kid.ts";
export { KidVote, KID_VOTES, type KidVoteDoc } from "./models/kid-vote.ts";
export { Store, STORE_STATUSES, type StoreDoc } from "./models/store.ts";
export { Item, ITEM_STATUSES, type ItemDoc } from "./models/item.ts";
export {
  Deed,
  DeedType,
  DEED_STATUSES,
  DEED_OUTCOMES,
  type DeedDoc,
  type DeedTypeDoc,
} from "./models/deed.ts";
export {
  Transaction,
  TRANSACTION_TYPES,
  type TransactionDoc,
} from "./models/transaction.ts";
export { Season, type SeasonDoc } from "./models/season.ts";
export { Lock, ensureLock, takeLock, type LockDoc } from "./models/lock.ts";
export {
  Payment,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  PAYMENT_FULFILMENTS,
  type PaymentDoc,
} from "./models/payment.ts";
export { StripeEvent, STRIPE_EVENT_STATUSES, type StripeEventDoc } from "./models/stripe-event.ts";
export {
  ActionToken,
  ACTION_TOKEN_PURPOSES,
  type ActionTokenDoc,
  type ActionTokenPurpose,
} from "./models/action-token.ts";
export { RateLimit, type RateLimitDoc } from "./models/rate-limit.ts";
export { PlatformSettings, type PlatformSettingsDoc } from "./models/platform-settings.ts";
export { DonationReceipt, DONATION_RECEIPT_STATUSES, type DonationReceiptDoc } from "./models/donation-receipt.ts";
export { DonationSplit, SPLIT_POOL_STATUSES, type DonationSplitDoc } from "./models/donation-split.ts";
export { SeasonReset, type SeasonResetDoc } from "./models/season-reset.ts";
export { PayLaterRequest, PAY_LATER_STATUSES, type PayLaterRequestDoc } from "./models/pay-later-request.ts";
export { AuditLog, AUDIT_ACTIONS, type AuditAction, type AuditLogDoc } from "./models/audit-log.ts";
export {
  WishListItem,
  WISH_LIST_STATUSES,
  type WishListItemDoc,
} from "./models/wish-list-item.ts";
