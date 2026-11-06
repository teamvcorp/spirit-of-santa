// No-database tests for the database-name rule (src/connect.ts resolveDbName).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDbName } from "../src/connect.ts";

const HOST = "mongodb+srv://user:pw@cluster0.abc.mongodb.net";

test("database name comes from the URI path", () => {
  assert.equal(resolveDbName(`${HOST}/spiritofsanta?retryWrites=true`, undefined), "spiritofsanta");
  assert.equal(resolveDbName(`${HOST}/spiritofsanta_dev`, undefined), "spiritofsanta_dev");
  assert.equal(resolveDbName("mongodb://localhost:27017/local_db", undefined), "local_db");
});

test("MONGODB_DB wins over the URI", () => {
  assert.equal(resolveDbName(`${HOST}/other?retryWrites=true`, "spiritofsanta"), "spiritofsanta");
  assert.equal(resolveDbName(`${HOST}/?retryWrites=true`, " spiritofsanta "), "spiritofsanta");
});

test("NO database name anywhere → refuse (never MongoDB's silent 'test')", () => {
  assert.throws(() => resolveDbName(`${HOST}/?retryWrites=true&w=majority`, undefined), /no database name/);
  assert.throws(() => resolveDbName(HOST, undefined), /no database name/);
  assert.throws(() => resolveDbName(`${HOST}/?x=1`, ""), /no database name/);
});

test("MONGODB_DB must be a plain name", () => {
  assert.throws(() => resolveDbName(`${HOST}/x`, "bad name/../"), /plain database name/);
});
