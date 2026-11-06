# Mongoose 9 — project notes

Pinned: **mongoose 9.11.4** (MongoDB driver ~7.7). Sources: https://mongoosejs.com/docs/migrating_to_9.html,
https://mongoosejs.com/docs/api/mongoose.html (read 2026-11-04). Requires Node >= 20.19.

## Breaking changes vs. older tutorials / training data

| Old (≤8) | Mongoose 9 |
|---|---|
| `schema.pre('save', function (next) { …; next() })` | **`next` removed.** Use `async function () { … }` and `throw` to abort |
| `findOneAndUpdate(f, u, { new: true })` | `{ returnDocument: 'after' }` (`new` deprecated) |
| `FilterQuery<T>` type | **`QueryFilter<T>`**, top-level keys type-checked |
| `Model.create<T>(…)` generic | no generic; takes `Partial<RawDocType>` |
| update with aggregation pipeline `[...]` | throws unless `{ updatePipeline: true }`. Keep it OFF (pipelines aren't cast) |
| `index({…}, { background: true })` | `background` option removed |

**Aggregation pipelines are NOT cast or sanitised** (unlike find/update filters): `{ $match: { itemId: "<hex>" } }`
matches nothing because the stored value is an ObjectId, and `sanitizeFilter` doesn't apply. Pass DB-sourced ObjectIds
and never request input (`packages/stores/src/engagement.ts`). Source: Mongoose docs, `Model.aggregate()` does no casting.
| UUID fields as strings | `bson.UUID` instances |
| `doc.id` typed `any` | typed `string` |

## Global settings this repo uses (packages/db/src/connect.ts)

- `sanitizeFilter: true` wraps any nested `$`-key object in a filter with `$eq`, so injected
  `{ password: { $ne: null } }` becomes a literal match and the injection fails.
  **Consequence:** operators WE write must be wrapped:
  ```ts
  import { trusted } from "mongoose";
  Item.find({ storeId, priceCents: trusted({ $lte: max }) });
  ```
  Only ever wrap objects built in our code, **never** user input. `trusted()` is easy to grep for in review.
- `strictQuery: "throw"`: filtering on a path not in the schema throws instead of being
  silently dropped (a dropped filter could widen a query or a delete).
- `autoIndex` only outside production; production indexes are built deliberately (`syncIndexes`).

## Patterns

- **Connection caching (serverless):** cache the connect promise on `globalThis` so hot reloads and
  warm Lambda invocations reuse one pool.
- **Model re-registration:** `models.X ?? model("X", schema)` avoids `OverwriteModelError` on HMR.
- **Types:** `InferSchemaType<typeof schema>` for raw shape; `HydratedDocument<T>` for docs.
- **Money/points transactions:** `const s = await mongoose.startSession(); await s.withTransaction(async () => …)`.
  Requires a replica set (Atlas always is).
