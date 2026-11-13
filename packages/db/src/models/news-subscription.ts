/**
 * NewsSubscription = one ADULT who asked for Spirit of Santa news emails (owner 2026-11-12), and OUR proof of
 * consent. The contact list itself lives in Resend (a "segment", RESEND_SEGMENT_ID); this row records WHO agreed,
 * WHEN, WHERE (source) and to WHICH wording (consentVersion), so a complaint can always be answered.
 *
 * Rules:
 *  - A row only exists once the email is PROVEN: parents after they confirm their account email, everyone else
 *    after clicking the "confirm" link (double opt-in, ActionToken purpose "news_confirm"). So nobody can sign up
 *    someone else's address.
 *  - Children are never subscribers (no source for them; the forms say "18 or older").
 *  - Unsubscribing keeps the row (status "unsubscribed" + time): proof that we stopped. Account deletion removes it.
 *  - syncedAt = the last time Resend accepted the current status. null = Resend was down; the daily job retries.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type InferSchemaType, type Model } from "mongoose";
const { Schema, model, models } = mongoose;
import { objectId } from "./_shared.ts";

/** Where the person said yes: parent sign-up/settings, the public form, or the donate/tip pages. */
export const NEWS_SOURCES = ["parent", "public", "donor", "tip"] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];
export const NEWS_STATUSES = ["subscribed", "unsubscribed"] as const;

const newsSubscriptionSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    status: { type: String, enum: NEWS_STATUSES, required: true },
    source: { type: String, enum: NEWS_SOURCES, required: true },
    locale: { type: String, enum: ["en", "es"], default: "en" },
    /** The parent's account, when the subscriber is a parent (so settings + deletion find it). */
    userId: objectId("User", false),
    /** Version of the opt-in wording they ticked (@repo/lib/news NEWS_CONSENT_VERSION). */
    consentVersion: { type: String, required: true, maxlength: 40 },
    /** When they ticked the box / asked. */
    consentAt: { type: Date, required: true },
    /** When the email was proven (confirm click, or the parent's verified account email). */
    confirmedAt: { type: Date, required: true },
    unsubscribedAt: Date,
    /** Resend has the current status (null = still to send; retried by the daily job). */
    syncedAt: Date,
  },
  { timestamps: true, versionKey: false },
);

newsSubscriptionSchema.index({ userId: 1 }, { sparse: true });
newsSubscriptionSchema.index({ syncedAt: 1 }); // retry queue (syncedAt null)
newsSubscriptionSchema.index({ status: 1, source: 1 }); // admin count

export type NewsSubscriptionDoc = InferSchemaType<typeof newsSubscriptionSchema>;
export const NewsSubscription = (models.NewsSubscription ??
  model("NewsSubscription", newsSubscriptionSchema)) as Model<NewsSubscriptionDoc>;
