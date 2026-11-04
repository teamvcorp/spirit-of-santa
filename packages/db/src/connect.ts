/**
 * MongoDB connection helper. SERVER-ONLY. All three apps share one Atlas cluster.
 *
 * Usage (Server Component, Server Action, or Route Handler):
 *   import { connectDb, User } from "@repo/db";
 *   await connectDb();
 *   const user = await User.findById(id);
 *
 * Mongoose notes for this repo: docs/vendor/mongoose-9.md
 */
import "server-only";
import mongoose from "mongoose";

// ── Global safety settings (apply before any model is used) ──────────────────────────
// Neutralise NoSQL query-selector injection: any nested object with a `$` key in a filter
// gets wrapped in `$eq`. Operators we write ourselves must be wrapped in `trusted()`.
mongoose.set("sanitizeFilter", true);
// Filtering on a field that isn't in the schema throws instead of being silently dropped.
mongoose.set("strictQuery", "throw");
// Build indexes automatically in dev only. In production, run syncIndexes deliberately
// so a deploy never triggers an unexpected index build on a live collection.
mongoose.set("autoIndex", process.env.NODE_ENV !== "production");

// ── Connection cache ────────────────────────────────────────────────────────────────
// Serverless functions and Next dev hot-reloads re-run module code. Caching the connect
// PROMISE on globalThis means every invocation in the same process shares one pool
// instead of opening a new one each time (which would exhaust Atlas connection limits).
type MongooseCache = { promise: Promise<typeof mongoose> | null };
const globalForMongoose = globalThis as typeof globalThis & {
  __mongoose?: MongooseCache;
};
const cache = (globalForMongoose.__mongoose ??= { promise: null });

export function connectDb(): Promise<typeof mongoose> {
  if (!cache.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      // Never include the URI itself in errors or logs: it contains the DB password.
      throw new Error(
        "MONGODB_URI is not set. Copy .env.example to .env.local.",
      );
    }
    cache.promise = mongoose
      .connect(uri, {
        maxPoolSize: 10, // small pools: many concurrent serverless instances share Atlas limits
        serverSelectionTimeoutMS: 5_000, // fail fast instead of hanging a request
        bufferCommands: false, // queries before connect() throw instead of queueing silently
      })
      .catch((err: unknown) => {
        cache.promise = null; // allow the next request to retry
        throw err;
      });
  }
  return cache.promise;
}
