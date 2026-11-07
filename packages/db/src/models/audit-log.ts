/**
 * AuditLog = append-only record of privileged actions (admin approves/rejects/suspends a
 * store, changes a discount, sends an invite; later: point adjustments, refunds review...).
 *
 * Why: these actions change money and access. An audit trail answers "who did this, when,
 * and what changed?" for support, disputes and security reviews, and deters misuse.
 * Like the ledger, it's append-only through Mongoose (updates/deletes throw). For real
 * immutability the Atlas app user should only have find/insert on this collection (same
 * TODO as transactions in docs/CODEMAP.md).
 *
 * Never store secrets, passwords, tokens or full personal data in `details`: ids, statuses
 * and the specific fields that changed are enough.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { objectId } from "./_shared.ts";

export const AUDIT_ACTIONS = [
  "wish.ship",
  "wish.receive",
  "wish.deliver",
  "wish.substitute",
  "payout.record",
  "family.notify_prefs",
  "family.address_update",
  "family.address_delete",
  "family.address_view",
  "store.approve",
  "store.reject",
  "store.suspend",
  "store.reinstate",
  "store.discount",
  "store.invite",
  "store.invite_accepted",
  "store.invite_resent",
  "store.invite_cancelled",
  "store.profile_update",
  "store.photo_add",
  "store.photo_remove",
  "rep.invite",
  "rep.accept",
  "rep.remove",
  "item.create",
  "item.update",
  "item.price",
  "item.archive",
  "item.restore",
  "user.mfa_enable",
  "user.mfa_reset",
  "user.mfa_recovery_used",
  "user.mfa_locked",
  "user.suspend",
  "user.reinstate",
  "user.unlock",
  "user.sign_out_all",
  "season.dates",
  "season.store_window",
  "season.force_freeze",
  "deed_type.create",
  "deed_type.update",
  "deed_type.activate",
  "deed_type.deactivate",
  "deed_type.reorder",
  "deed_type.seed",
  "kid.add",
  "kid.update",
  "kid.delete",
  "family.delete",
  "family.pin_set",
  "family.alias",
  "family.alias_review",
  "kid.vote",
  "kid.donation_link_reset",
  "kid.register_promo",
  "deed.create",
  "deed.text_review",
  "settings.update",
  "donations.split",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const auditLogSchema = new Schema(
  {
    /** Who did it. Absent = the system (e.g. the daily job deleting addresses no gift needs). */
    actorUserId: objectId("User", false),
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    targetType: { type: String, enum: ["store", "user", "item", "season", "deed_type", "kid", "family", "deed", "settings", "donation_split", "wish_list_item"], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    /** Small JSON of what changed, e.g. { from: "pending", to: "approved", discountBps: 2000 }. */
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 }); // admin dashboard "recent activity"

const appendOnly = () => {
  throw new Error("Audit log entries are append-only");
};
auditLogSchema.pre("save", function () {
  if (!this.isNew) appendOnly();
});
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  auditLogSchema.pre(op, appendOnly);
}
auditLogSchema.pre("bulkWrite", appendOnly);

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = (models.AuditLog ?? model("AuditLog", auditLogSchema)) as Model<AuditLogDoc>;
