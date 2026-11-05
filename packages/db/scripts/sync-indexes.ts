/**
 * Build/update every MongoDB index declared in our Mongoose models. Run once before launch,
 * and again whenever a model's indexes change.
 *
 *   PowerShell:  $env:MONGODB_URI = "<production URI>"; npm run db:sync-indexes
 *   (or put MONGODB_URI in a local file and use: node --env-file=<file> ...)
 *
 * Why this exists: production sets autoIndex OFF (connect.ts) so a deploy never starts an
 * index build on a live database by surprise. But several indexes are SECURITY/INTEGRITY
 * features, not just speed:
 *  - unique: transactions.idempotencyKey, payments.stripePaymentIntentId,
 *    stripeevents.eventId (no double-crediting), actiontokens.tokenHash, users.email,
 *    stores.slug, ratelimits.{key,windowStart}
 *  - TTL (auto-delete): actiontokens, ratelimits, stripeevents
 * Without them, duplicates become possible and cleanups never run.
 *
 * syncIndexes() creates missing indexes and DROPS indexes that are no longer declared in the
 * schema. It prints a summary per collection. Safe to re-run.
 */
// Default import: mongoose is CommonJS.
import mongoose from "mongoose";
import * as db from "../src/index.ts";

async function main() {
  const conn = await db.connectDb();
  const name = conn.connection.name;
  console.log(`[indexes] database: ${name}`);
  const models = Object.values(mongoose.models);
  for (const model of models) {
    const dropped = await model.syncIndexes();
    const indexes = await model.collection.indexes();
    console.log(
      `[indexes] ${model.collection.collectionName.padEnd(16)} ${indexes.length} index(es)` +
        (dropped.length ? `; dropped stale: ${dropped.join(", ")}` : ""),
    );
  }
  await conn.disconnect();
  console.log("[indexes] done");
}

main().catch((err: unknown) => {
  // Never print the URI (it contains the password).
  console.error("[indexes] failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  process.exit(1);
});
