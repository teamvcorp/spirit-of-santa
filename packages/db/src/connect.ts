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
// Build indexes automatically ONLY under `next dev` (NODE_ENV=development). Everywhere else
// (production, and CLI scripts like admin:create / db:sync-indexes where NODE_ENV is unset
// but MONGODB_URI may point at the LIVE database) it stays off: run `npm run db:sync-indexes`
// deliberately so nothing starts an unexpected index build on a live collection.
// Opt-in rather than opt-out: an unknown environment defaults to the safe choice.
mongoose.set("autoIndex", process.env.NODE_ENV === "development");

// ── Connection cache ────────────────────────────────────────────────────────────────
// Serverless functions and Next dev hot-reloads re-run module code. Caching the connect
// PROMISE on globalThis means every invocation in the same process shares one pool
// instead of opening a new one each time (which would exhaust Atlas connection limits).
type MongooseCache = { promise: Promise<typeof mongoose> | null };
const globalForMongoose = globalThis as typeof globalThis & {
  __mongoose?: MongooseCache;
};
const cache = (globalForMongoose.__mongoose ??= { promise: null });

/**
 * Which database to use. MONGODB_DB (optional) wins; otherwise the name in the URI path
 * ("…mongodb.net/spiritofsanta?…"). With NEITHER, MongoDB silently uses "test": that hid a
 * production sign-in bug (2026-11-06: the Vercel Atlas integration's URI had no database name,
 * so the site read "test" while the admin was in "spiritofsanta"). So no name = refuse to start.
 * Pure (exported for tests).
 */
export function resolveDbName(uri: string, override: string | undefined): string {
  const fromEnv = override?.trim();
  if (fromEnv) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(fromEnv)) throw new Error("MONGODB_DB must be a plain database name (letters, digits, _ or -)");
    return fromEnv;
  }
  const path = uri.replace(/^mongodb(\+srv)?:\/\/[^/]*/, "").split("?")[0] ?? "";
  const name = decodeURIComponent(path.replace(/^\//, ""));
  if (!name) throw new Error("MONGODB_URI has no database name (…mongodb.net/<name>?…): add it, or set MONGODB_DB (e.g. spiritofsanta)");
  return name;
}

export function connectDb(): Promise<typeof mongoose> {
  if (!cache.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      // Never include the URI itself in errors or logs: it contains the DB password.
      throw new Error(
        "MONGODB_URI is not set. Copy .env.example to .env.local.",
      );
    }
    // Throws with a clear message (no URI in it) when no database name is given anywhere.
    const dbName = resolveDbName(uri, process.env.MONGODB_DB);
    cache.promise = mongoose
      .connect(uri, {
        dbName,
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

/**
 * Run `fn` inside a MongoDB transaction: every write made with `{ session }` commits
 * together or not at all. Mongoose's connection.transaction() retries on transient errors
 * (e.g. write conflicts) and resets document state if the transaction aborts.
 *
 * Use for anything that must stay consistent: a ledger row + the kid balance it changes.
 * Pass `session` to EVERY read/write inside, or that operation runs outside the transaction.
 */
/** A MongoDB session (pass as { session } to every query inside withTransaction). */
export type DbSession = mongoose.mongo.ClientSession;

export async function withTransaction<T>(
  fn: (session: DbSession) => Promise<T>,
): Promise<T> {
  const m = await connectDb();
  return m.connection.transaction(fn);
}

/**
 * Mark a filter operator WE wrote (e.g. { $ne: "x" }, { $in: [...] }) as safe. The global
 * sanitizeFilter setting otherwise rewrites `$` keys in filters to literal matches (that's
 * the NoSQL-injection guard for user input). Never wrap values that came from a request.
 */
export function trusted<T>(operator: T): T {
  return mongoose.trusted(operator) as T;
}
