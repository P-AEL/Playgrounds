import test from "node:test";
import assert from "node:assert/strict";
import { SharedStore, loadPlaces, jsonRequest, searchCity, waitForBackend } from "../lib/api.js";
const config = { apiBaseUrl: "https://api.example.test" };
const place = { id: "node/10", name: "Playground", latitude: 52, longitude: 13, kind: "playground" };
const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
test("unconfigured shared storage cannot silently save locally", async () => {
  const store = new SharedStore({});
  assert.equal(store.ready, false);
  await assert.rejects(store.saveRating(place, { variety: 1, climbability: 2, pull_ups: 3 }), /not been set up/);
});
test("only HTTPS or local API endpoints are accepted, never database credentials", () => {
  for (const url of ["http://api.example.test", "mongodb+srv://user:secret@example.test", "https://user:secret@api.example.test", "https://api.example.test?token=secret"]) assert.throws(() => new SharedStore({ apiBaseUrl: url }));
  assert.equal(new SharedStore({ apiBaseUrl: "http://127.0.0.1:4173" }).ready, true);
});
test("browser requests do not send credentials or database keys", async () => {
  const store = new SharedStore(config, async (url, options) => {
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.apikey, undefined);
    return response({ items: [], nextCursor: null });
  });
  await store.load();
});
test("rating updates use one shared playground ID and preserve zero scores", async () => {
  let sent;
  const store = new SharedStore(config, async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return response({ ...place, variety: 0, climbability: 0, pull_ups: 0 });
  });
  const saved = await store.saveRating(place, { variety: 0, climbability: 0, pull_ups: 0 });
  assert.equal(saved.variety, 0);
  assert.equal(sent.url, "https://api.example.test/api/atlas");
  assert.deepEqual(sent.body, { action: "rate", place, rating: { variety: 0, climbability: 0, pull_ups: 0 } });
});
test("visits preserve UTC timestamps and require the server to confirm the idempotent UUID", async () => {
  const id = "88d64d8a-32e1-4f0b-a0ca-48d0e6db0381", timestamp = "2025-04-03T12:00:00.000Z";
  let body;
  const store = new SharedStore(config, async (url, options) => {
    body = JSON.parse(options.body);
    return response({ id, playground_id: place.id, visited_at: timestamp });
  });
  const saved = await store.addVisit(place, timestamp, id);
  assert.equal(body.visitId, id); assert.equal(body.visitedAt, timestamp);
  assert.equal(saved.playground_id, place.id);
  const failed = new SharedStore(config, async () => response({ id: "wrong" }));
  await assert.rejects(failed.addVisit(place, timestamp, id), /did not confirm/);
});

test("deletion uses a confirmed, scoped request and requires the matching server response", async () => {
  const visitId = "88d64d8a-32e1-4f0b-a0ca-48d0e6db0381";
  let writes = 0;
  const store = new SharedStore(config, async (url, options) => {
    writes++; const body = JSON.parse(options.body);
    assert.equal(options.method, "POST"); assert.equal(body.confirmed, true);
    return response({ deleted: true, ...body });
  });
  for (const target of ["place", "rating", "visit"]) await store.deleteEntry(target, place.id, visitId);
  assert.equal(writes, 3);
  await assert.rejects(store.deleteEntry("all", place.id));
  await assert.rejects(store.deleteEntry("place", { $ne: null }));
  await assert.rejects(store.deleteEntry("visit", place.id, "invalid"));
  assert.equal(writes, 3);
  const wrong = new SharedStore(config, async () => response({ deleted: true, target: "place", placeId: "node/11" }));
  await assert.rejects(wrong.deleteEntry("place", place.id), /did not confirm/);
  const failed = new SharedStore(config, async () => response({}, 503));
  await assert.rejects(failed.deleteEntry("place", place.id), /unavailable/);
});
test("cursor pagination loads the full collection and rejects repeated cursors", async () => {
  const records = Array.from({ length: 1001 }, (_, i) => ({ ...place, id: `node/${i}` }));
  let page = 0;
  const store = new SharedStore(config, async url => {
    const parsed = new URL(url);
    if (parsed.searchParams.get("resource") === "visits") return response({ items: [], nextCursor: null });
    const offset = page++ * 500;
    return response({ items: records.slice(offset, offset + 500), nextCursor: offset < 1000 ? records[offset + 499].id : null });
  });
  assert.equal((await store.load()).places.length, 1001);
  const broken = new SharedStore(config, async () => response({ items: [], nextCursor: "node/1" }));
  await assert.rejects(broken.load(), /repeated page cursor/);
});
test("a failed or malformed snapshot read cannot replace the shared state", async () => {
  const store = new SharedStore(config, async url => new URL(url).searchParams.get("resource") === "visits" ? response({}, 503) : response({ items: [place], nextCursor: null }));
  await assert.rejects(store.load(), /unavailable/);
  const malformed = new SharedStore(config, async () => response([]));
  await assert.rejects(malformed.load(), /invalid data/);
});
test("rate limits and denied access produce actionable failures", async () => {
  for (const [status, pattern] of [[503, /busy/], [429, /wait/], [403, /denied/]]) await assert.rejects(jsonRequest("https://example.test", {}, async () => response({}, status)), pattern);
});
test("Overpass runtime errors are not mistaken for complete results", async () => {
  const bounds = { south: 52.50, west: 13.38, north: 52.54, east: 13.44 };
  await assert.rejects(loadPlaces(bounds, "https://example.test", async () => response({ elements: [], remark: "runtime error: timeout" })), /could not be completed/);
});
test("a failed mirror or empty regional result falls back to a global provider", async () => {
  const bounds = { south: 52.50, west: 13.38, north: 52.54, east: 13.44 };
  for (const primary of [response({}, 503), response({ elements: [] })]) {
    let requests = 0;
    const places = await loadPlaces(bounds, ["https://regional.test", "https://global.test"], async () => ++requests === 1 ? primary : response({ elements: [{ type: "node", id: 123, lat: 52.52, lon: 13.40, tags: { leisure: "playground" } }] }));
    assert.equal(places.length, 1); assert.equal(requests, 2);
  }
});
test("place search requests English names", async () => {
  await searchCity("Copenhagen", "https://geocode.example.test", async url => {
    assert.equal(new URL(url).searchParams.get("accept-language"), "en"); return response([]);
  });
});
test("a sleeping backend wakes through temporary errors and HTML without retrying writes", async () => {
  let clock = 0, requests = 0;
  const options = { timeoutMs: 10000, retryDelayMs: 2000, now: () => clock, wait: async ms => { clock += ms; } };
  await waitForBackend("https://app.onrender.com", async () => {
    if (++requests === 1) return response({}, 503);
    if (requests === 2) return new Response("<html>Starting</html>");
    return response({ status: "ok", storage: "mongodb" });
  }, options);
  assert.equal(requests, 3);
  let healthRequests = 0, writes = 0;
  const store = new SharedStore({ apiBaseUrl: "https://app.onrender.com" }, async url => {
    if (new URL(url).searchParams.get("resource") === "health") { healthRequests++; return response({ status: "ok", storage: "mongodb" }); }
    writes++; return response({}, 503);
  }, options);
  await assert.rejects(store.saveRating(place, { variety: 1, climbability: 2, pull_ups: 3 }));
  assert.equal(healthRequests, 1); assert.equal(writes, 1);
});
test("startup wait is bounded and access errors fail immediately", async () => {
  let clock = 0, requests = 0;
  const options = { timeoutMs: 5000, retryDelayMs: 2000, now: () => clock, wait: async ms => { clock += ms; } };
  await assert.rejects(waitForBackend("https://app.onrender.com", async () => response({}, 503), options), /taking longer/);
  assert.equal(clock, 5000);
  await assert.rejects(waitForBackend("https://app.onrender.com", async () => { requests++; return response({}, 403); }, options), /rejected/);
  assert.equal(requests, 1);
});
