// Real integration test. Only newly created, uniquely named test collections are used.
import assert from "node:assert/strict";
import http from "node:http";
import { MongoClient } from "mongodb";
import { loadLocalEnvironment } from "../server/env.mjs";
import { mongoConfiguration } from "../server/mongo.mjs";
import { createAtlasHandler } from "../server/atlas.mjs";
import { SharedStore } from "../lib/api.js";
loadLocalEnvironment();
const { uri, database } = mongoConfiguration();
const name = `atlas_test_${crypto.randomUUID().replaceAll("-", "")}`;
let client, server, created = false, phase = "connect";
try {
  client = new MongoClient(uri, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const actualDb = client.db(database); phase = "new test collections";
  const tables = [name + "_places", name + "_visits"];
  for (const table of tables) assert.equal(await actualDb.collection(table).findOne({}), null);
  const db = { collection: table => actualDb.collection(name + (table === "playgrounds" ? "_places" : "_visits")), command: value => actualDb.command(value) };
  created = true;
  server = http.createServer(createAtlasHandler({ getDatabase: async () => db }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const config = { apiBaseUrl: `http://127.0.0.1:${server.address().port}` };
  const deviceA = new SharedStore(config), deviceB = new SharedStore(config);
  const place = { id: "node/999999999999", name: "Disposable integration test", latitude: 55.6761, longitude: 12.5683, kind: "playground" };
  phase = "save zero rating";
  await deviceA.saveRating(place, { variety: 0, climbability: 0, pull_ups: 0 });
  phase = "read from second client";
  assert.equal((await deviceB.load()).places[0].variety, 0);
  phase = "update shared rating";
  await deviceB.saveRating(place, { variety: 10, climbability: 8, pull_ups: 6 });
  const timestamp = "2026-01-02T13:45:00.000Z", id = crypto.randomUUID();
  phase = "concurrent idempotent visit";
  await Promise.all([deviceA.addVisit(place, timestamp, id), deviceB.addVisit(place, timestamp, id)]);
  let snapshot = await deviceA.load();
  assert.equal(snapshot.places.length, 1); assert.equal(snapshot.visits.length, 1);
  assert.equal(snapshot.places[0].variety, 10); assert.equal(snapshot.visits[0].visited_at, timestamp);
  phase = "separate concurrent visits";
  await Promise.all([deviceA.addVisit(place, timestamp), deviceB.addVisit(place, timestamp)]);
  snapshot = await deviceB.load(); assert.equal(snapshot.visits.length, 3);
  assert.equal(snapshot.places[0].pull_ups, 6);
  phase = "reject conflicting visit UUID";
  const secondPlace = { ...place, id: "way/999999999999" };
  await assert.rejects(deviceA.addVisit(secondPlace, timestamp, id));
  phase = "reject invalid ratings";
  const forged = await fetch(`${config.apiBaseUrl}/api/atlas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rate", place, rating: { variety: 11, climbability: 1, pull_ups: 1 } }) });
  assert.equal(forged.status, 400);
  console.log("PASS: real MongoDB; two clients; one shared rating; zero scores; UTC timestamps; concurrent/idempotent visits; preserved rating; invalid requests rejected.");
} catch (error) {
  const category = /not allowed|not authorized|unauthorized|permission/i.test(error.message) ? "database permissions" : /authentication|bad auth/i.test(error.message) ? "database authentication" : "request or assertion failure";
  console.error(JSON.stringify({ result: "MongoDB integration test failed", phase, category, kind: error.name, code: typeof error.code === "number" ? error.code : undefined })); process.exitCode = 1;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (created && /^atlas_test_[a-f0-9]{32}$/.test(name)) {
    for (const suffix of ["_places", "_visits"]) {
      try { await client.db(database).collection(name + suffix).drop(); }
      catch (error) { if (error.code !== 26) { console.error("Unable to remove a disposable test collection. No credentials were printed."); process.exitCode = 1; } }
    }
  }
  await client?.close();
}
