/**
 * Lock = a named document that transactions WRITE FIRST to take turns (serialize) when an
 * invariant spans many documents, e.g. "the deed catalog's starter set is added only once" or
 * "new deeds go at the end". MongoDB lets only one transaction write a document at a time, so a
 * second transaction conflicts, is retried by withTransaction, and then sees the first one's
 * result. Same idea as Store.itemLockSeq (per-store item limit).
 *
 *   await ensureLock("deed-catalog");                     // OUTSIDE the transaction (upsert)
 *   await withTransaction(async (session) => {
 *     await takeLock("deed-catalog", session);           // first write inside
 *     ...read, check, write...
 *   });
 * (Creating it inside would make two first-time racers hit a duplicate-key error, which isn't
 * retried; so it's created beforehand.)
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose, { type Model } from "mongoose";
const { Schema, model, models } = mongoose;

const lockSchema = new Schema(
  {
    _id: { type: String, required: true, maxlength: 100 },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export type LockDoc = { _id: string; seq: number };
export const Lock = (models.Lock ?? model("Lock", lockSchema)) as Model<LockDoc>;

/** Make sure the lock document exists (call outside the transaction). */
export async function ensureLock(name: string): Promise<void> {
  await Lock.updateOne({ _id: name }, { $setOnInsert: { seq: 0 } }, { upsert: true }).catch((err: unknown) => {
    if ((err as { code?: number }).code !== 11000) throw err; // a racer created it: fine
  });
}

/** Take the lock inside a transaction (pass its session). */
export async function takeLock(name: string, session: mongoose.mongo.ClientSession): Promise<void> {
  await Lock.updateOne({ _id: name }, { $inc: { seq: 1 } }, { session });
}
