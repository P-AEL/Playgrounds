import test from "node:test";
import assert from "node:assert/strict";
import { createAtlasHandler, normalizePlace, listRecords } from "../server/atlas.mjs";
import { mongoConfiguration } from "../server/mongo.mjs";
const place = { id: "node/10", name: "Playground", latitude: 55.676, longitude: 12.568, kind: "playground" };
const visitId = "88d64d8a-32e1-4f0b-a0ca-48d0e6db0381";
async function call(overrides = {}, getDatabase = async () => { throw new Error("Unexpected database call"); }) {
  const req = { method: "POST", url: "/api/atlas", headers: { origin: "https://p-ael.github.io", "content-type": "application/json" }, body: { action: "rate", place, rating: { variety: 1, climbability: 2, pull_ups: 3 } }, ...overrides };
  const headers = {};
  const res = { statusCode: 200, setHeader(name, value) { headers[name] = value; }, end(body) { this.body = body; } };
  await createAtlasHandler({ getDatabase, origins: ["https://p-ael.github.io"] })(req, res);
  return { status: res.statusCode, headers, body: res.body ? JSON.parse(res.body) : null };
}
test("database settings require an actual URI and a bounded database name", () => {
  assert.throws(() => mongoConfiguration({ MONGODB_URI: "mongodb+srv://user:<db_password>@example.test" }));
  assert.throws(() => mongoConfiguration({ MONGODB_URI: "mongodb://localhost", MONGODB_DB: "admin.$cmd" }));
  assert.equal(mongoConfiguration({ MONGODB_URI: "mongodb://localhost" }).database, "playground_atlas");
});
test("only safe playground fields can reach MongoDB", () => {
  const normalized = normalizePlace({ ...place, $set: { secret: true }, variety: 10, rated_at: "malicious" });
  assert.equal(normalized.$set, undefined); assert.equal(normalized.variety, undefined); assert.equal(normalized.rated_at, undefined);
  for (const invalid of [{ name: { $gt: "" } }, { equipment: [{ $where: "code" }] }, { latitude: Infinity }, { id: { $ne: null } }, { kind: "unknown" }]) assert.throws(() => normalizePlace({ ...place, ...invalid }));
});
test("the API supports explicit-origin CORS and rejects other origins before touching the database", async () => {
  const allowed = await call({ method: "OPTIONS" });
  assert.equal(allowed.status, 204); assert.equal(allowed.headers["Access-Control-Allow-Origin"], "https://p-ael.github.io");
  const denied = await call({ headers: { origin: "https://evil.example" } });
  assert.equal(denied.status, 403); assert.equal(denied.headers["Access-Control-Allow-Origin"], undefined);
});
test("invalid writes fail before a database connection is opened", async () => {
  const bodies = [
    { action: "delete", place },
    { action: "rate", place, rating: { variety: 11, climbability: 2, pull_ups: 3 } },
    { action: "rate", place, rating: { variety: 1.5, climbability: 2, pull_ups: 3 } },
    { action: "visit", place, visitedAt: "2099-01-01T00:00:00Z", visitId },
    { action: "visit", place, visitedAt: "2025-01-01T00:00:00Z", visitId: "bad" },
    { action: "rate", place: { ...place, longitude: "12" }, rating: { variety: 1, climbability: 2, pull_ups: 3 } }
  ];
  for (const body of bodies) assert.equal((await call({ body })).status, 400);
  assert.equal((await call({ body: "invalid JSON" })).status, 400);
  assert.equal((await call({ headers: { "content-type": "application/json", "content-length": "20000" } })).status, 413);
  assert.equal((await call({ headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call({ method: "DELETE" })).status, 405);
});
test("database errors cannot leak connection strings or passwords", async () => {
  const result = await call({}, async () => { throw new Error("mongodb+srv://user:top-secret@cluster.invalid/"); });
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result).includes("top-secret"), false);
  assert.equal(result.headers["Cache-Control"], "no-store");
});
test("page parameters cannot become MongoDB operators or unbounded reads", async () => {
  await assert.rejects(listRecords({}, "places", '{"$gt":""}'), /Invalid page cursor/);
  await assert.rejects(listRecords({}, "$cmd", null), /Unknown resource/);
  await assert.rejects(listRecords({}, "visits", null, 100000), /Invalid page size/);
});
test("health responds only after the database answers", async () => {
  const result = await call({ method: "GET" }, async () => ({ command: async command => assert.deepEqual(command, { ping: 1 }) }));
  assert.equal(result.status, 200); assert.deepEqual(result.body, { status: "ok", storage: "mongodb" });
});
