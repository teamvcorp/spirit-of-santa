/**
 * DEV-ONLY: create (or reset) one test account per role so sign-in can be tested end to end.
 *
 *   PowerShell:  $env:SEED_PASSWORD = "<12+ chars>"; npm run seed:dev
 *   bash:        SEED_PASSWORD='<12+ chars>' npm run seed:dev
 *   remove all:  npm run seed:dev -- --remove
 *
 * Accounts (all share SEED_PASSWORD; emails use the reserved .test domain, which can
 * never receive real mail):
 *   dev-parent@spiritofsanta.test   parent       family app  (+ "Dev Family")
 *   dev-owner@spiritofsanta.test    store_owner  store app   (+ "Dev Toy Shop")
 *   dev-rep@spiritofsanta.test      store_rep    store app
 *   dev-admin@spiritofsanta.test    admin        admin app
 *
 * Safety rails (why each exists):
 *  - Refuses NODE_ENV=production.
 *  - Refuses any database whose name doesn't end in "_dev", so test accounts with a shared
 *    password can never land in the real database (local .env.local → spiritofsanta_dev,
 *    Vercel → spiritofsanta).
 *  - The password comes from the environment, is never printed, and is stored only as an
 *    argon2id hash. Re-running bumps sessionVersion, which signs out old test sessions.
 */
// Default import: mongoose is CommonJS. trusted() marks OUR operators as safe; the global
// sanitizeFilter setting would otherwise strip `$in` (see docs/vendor/mongoose-9.md).
import mongooseLib from "mongoose";
import { connectDb, Family, Store, User } from "@repo/db";
import { hashSecret, MAX_SECRET_LENGTH } from "../src/password.ts";

const DOMAIN = "spiritofsanta.test";
const EMAILS = {
  parent: `dev-parent@${DOMAIN}`,
  owner: `dev-owner@${DOMAIN}`,
  rep: `dev-rep@${DOMAIN}`,
  admin: `dev-admin@${DOMAIN}`,
} as const;
const STORE_SLUG = "dev-toy-shop";

function fail(message: string): never {
  console.error(`[seed] ${message}`);
  process.exit(1);
}

async function main() {
  if (process.env.NODE_ENV === "production") fail("refusing to run with NODE_ENV=production");
  const remove = process.argv.includes("--remove");

  const mongoose = await connectDb();
  const dbName = mongoose.connection.name;
  if (!dbName.endsWith("_dev")) {
    await mongoose.disconnect();
    fail(`refusing to touch database "${dbName}": only *_dev databases may be seeded`);
  }

  if (remove) {
    const users = await User.find({ email: mongooseLib.trusted({ $in: Object.values(EMAILS) }) }).select("_id");
    const ids = users.map((u) => u._id);
    await Family.deleteMany({ ownerUserId: mongooseLib.trusted({ $in: ids }) });
    await Store.deleteMany({ slug: STORE_SLUG });
    const { deletedCount } = await User.deleteMany({ _id: mongooseLib.trusted({ $in: ids }) });
    console.log(`[seed] removed ${deletedCount} dev users (+ their family/store) from ${dbName}`);
    await mongoose.disconnect();
    return;
  }

  // Read only by this manual script (never by a turbo task), so not declared in turbo.json.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const password = process.env.SEED_PASSWORD ?? "";
  if (password.length < 12 || password.length > MAX_SECRET_LENGTH) {
    await mongoose.disconnect();
    fail(`set SEED_PASSWORD (12–${MAX_SECRET_LENGTH} characters) first`);
  }
  const passwordHash = await hashSecret(password);

  // Upsert by email: create if missing, otherwise reset password/lockout/status.
  const upsertUser = (email: string, role: string, name: string) =>
    User.findOneAndUpdate(
      { email },
      {
        $set: { passwordHash, role, name, status: "active", failedLoginCount: 0 },
        $unset: { lockedUntil: 1 },
        $inc: { sessionVersion: 1 },
      },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    );

  const parent = await upsertUser(EMAILS.parent, "parent", "Dev Parent");
  const owner = await upsertUser(EMAILS.owner, "store_owner", "Dev Store Owner");
  const rep = await upsertUser(EMAILS.rep, "store_rep", "Dev Store Rep");
  await upsertUser(EMAILS.admin, "admin", "Dev Admin");
  if (!parent || !owner || !rep) fail("user upsert returned nothing");

  const family = await Family.findOneAndUpdate(
    { ownerUserId: parent._id },
    { $set: { familyName: "Dev Family", zip: "50588" } },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
  );
  const store = await Store.findOneAndUpdate(
    { slug: STORE_SLUG },
    {
      $set: {
        name: "Dev Toy Shop",
        category: "toys",
        status: "approved",
        discountBps: 2000, // 20% off retail (dev value; real stores agree theirs with admin)
        ownerUserId: owner._id,
        repUserIds: [rep._id],
        "contact.email": EMAILS.owner,
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
  );
  if (!family || !store) fail("family/store upsert returned nothing");

  await User.updateOne({ _id: parent._id }, { $set: { familyId: family._id } });
  await User.updateMany({ _id: mongooseLib.trusted({ $in: [owner._id, rep._id] }) }, { $set: { storeId: store._id } });

  console.log(`[seed] ${dbName}: 4 dev users ready (${Object.values(EMAILS).join(", ")})`);
  await mongoose.disconnect();
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
});
