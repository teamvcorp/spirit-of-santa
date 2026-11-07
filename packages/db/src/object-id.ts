/**
 * Turn a VALIDATED 24-hex id string into a Mongo ObjectId.
 * Needed for aggregation pipelines: unlike find()/updateOne(), `Model.aggregate()` does NOT
 * cast strings to ObjectIds, so `{ $match: { _id: "65f..." } }` silently matches nothing.
 * Always run the raw input through normalizeObjectId (@repo/lib/ids) first; this throws on
 * anything that isn't a valid id.
 */
// Default import: mongoose is CommonJS, so named runtime imports fail under plain Node ESM.
import mongoose from "mongoose";

export function toObjectId(id: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

/** A fresh ObjectId (e.g. a run id as the audit target of a system action), without importing mongoose in apps. */
export function newObjectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}
