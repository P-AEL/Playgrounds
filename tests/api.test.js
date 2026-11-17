import test from "node:test";
import assert from "node:assert/strict";
import { SharedStore, loadPlaces, jsonRequest } from "../lib/api.js";
const config = { supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_test" };
const place = { id: "node/10", name: "Spielplatz", latitude: 52, longitude: 13, kind: "playground" };
const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
test("unconfigured shared storage cannot silently save locally", async () => {
  const store = new SharedStore({});
  assert.equal(store.ready, false);
  await assert.rejects(store.saveRating(place, { variety: 1, climbability: 2, pull_ups: 3 }), /not been set up/);
});
test("secret keys are rejected; publishable keys are not sent as bearer JWTs", async () => {
  assert.throws(() => new SharedStore({ ...config, supabaseKey: "sb_secret_forbidden" }), /secret key/);
  const serviceKey = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.test`;
  assert.throws(() => new SharedStore({ ...config, supabaseKey: serviceKey }), /public/);
  let headers;
  const store = new SharedStore(config, async (url, options) => { headers = options.headers; return response([]); });
  await store.load();
  assert.equal(headers.apikey, config.supabaseKey);
  assert.equal(headers.Authorization, undefined);
});
test("legacy anon JWTs are supported", async () => {
  const key = `e30.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.test`;
  const store = new SharedStore({ ...config, supabaseKey: key }, async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${key}`); return response([]);
  });
  await store.load();
});
test("rating updates use one shared playground ID and preserve a score of zero", async () => {
  let sent;
  const store = new SharedStore(config, async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return response({ ...place, variety: 0, climbability: 0, pull_ups: 0 }); });
  const saved = await store.saveRating(place, { variety: 0, climbability: 0, pull_ups: 0 });
  assert.equal(saved.variety, 0);
  assert.match(sent.url, /rpc\/save_playground_rating$/);
  assert.deepEqual(sent.body, { p_place: place, p_variety: 0, p_climbability: 0, p_pull_ups: 0 });
});
test("visits use an idempotent UUID and preserve their UTC timestamp", async () => {
  let body;
  const store = new SharedStore(config, async (url, options) => { body = JSON.parse(options.body); return response(null); });
  const id = "88d64d8a-32e1-4f0b-a0ca-48d0e6db0381", timestamp = "2025-04-03T12:00:00.000Z";
  const saved = await store.addVisit(place, timestamp, id);
  assert.equal(body.p_visit_id, id);
  assert.equal(body.p_visited_at, timestamp);
  assert.equal(saved.playground_id, place.id);
});
test("pagination loads more than 1000 shared records", async () => {
  const records = Array.from({ length: 1001 }, (_, i) => ({ ...place, id: `node/${i}` }));
  const store = new SharedStore(config, async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("playground_visits")) return response([]);
    const offset = Number(parsed.searchParams.get("offset"));
    return response(records.slice(offset, offset + 1000));
  });
  assert.equal((await store.load()).places.length, 1001);
});
test("a partial database read fails rather than replacing the shared state", async () => {
  const store = new SharedStore(config, async url => response(url.includes("playground_visits") ? {} : [place], url.includes("playground_visits") ? 503 : 200));
  await assert.rejects(store.load(), /paused/);
});
test("paused service, rate limits and denied access produce actionable failures", async () => {
  for (const [status, pattern] of [[503, /busy/], [429, /wait/], [403, /denied/]]) {
    await assert.rejects(jsonRequest("https://example.test", {}, async () => response({}, status)), pattern);
  }
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
    assert.equal(places.length, 1);
    assert.equal(requests, 2);
  }
});
