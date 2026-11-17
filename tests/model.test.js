import test from "node:test";
import assert from "node:assert/strict";
import { validPlace, validRating, score, fromOverpass, overpassQuery, boundsAllowed, distanceKm, googleMapsUrl, visitTimestamp, toLocalDateTime } from "../lib/model.js";

const place = { id: "way/123", name: "Spielplatz", latitude: 52.52, longitude: 13.405 };
test("zero is a real rating, while absent categories remain unrated", () => {
  assert.equal(score({ variety: 0, climbability: 0, pull_ups: 0 }), 0);
  assert.equal(score({ variety: 10, climbability: 5, pull_ups: 0 }), 5);
  assert.equal(score({ variety: null, climbability: null, pull_ups: null }), null);
  for (const invalid of [-1, 11, 2.5, "5", NaN, undefined]) assert.equal(validRating({ variety: invalid, climbability: 3, pull_ups: 4 }), false);
});
test("place IDs and coordinates are checked before saving", () => {
  assert.equal(validPlace(place), true);
  for (const replacement of [{ id: "<script>" }, { latitude: NaN }, { longitude: 181 }, { name: "" }, { latitude: "52" }]) assert.equal(validPlace({ ...place, ...replacement }), false);
});
test("Overpass normalizes nodes and polygon centres, ignores unrelated objects and deduplicates IDs", () => {
  const elements = [
    { type: "node", id: 1, lat: 52, lon: 13, tags: { leisure: "playground", "playground:swing": "yes" } },
    { type: "way", id: 2, center: { lat: 52.1, lon: 13.1 }, tags: { leisure: "fitness_station", name: "Outdoor Gym", fitness_station: "horizontal_bar;monkey_bars" } },
    { type: "node", id: 3, lat: 52, lon: 13, tags: { leisure: "park" } },
    { type: "way", id: 4, tags: { leisure: "playground" } }
  ];
  const results = fromOverpass([...elements, elements[0]]);
  assert.equal(results.length, 2);
  assert.equal(results[1].id, "way/2");
  assert.deepEqual(results[1].equipment, ["Pull-up bar", "Monkey bars"]);
  assert.deepEqual(results[0].equipment, ["Swings"]);
});
test("queries are bounded, numeric and restricted to the requested place types", () => {
  const bounds = { south: 52.50, west: 13.38, north: 52.54, east: 13.44 };
  assert.equal(boundsAllowed(bounds), true);
  assert.match(overpassQuery(bounds), /playground\|fitness_station/);
  assert.throws(() => overpassQuery({ ...bounds, north: "injection" }));
  assert.equal(boundsAllowed({ south: 45, west: 5, north: 55, east: 15 }), false);
  assert.equal(boundsAllowed({ south: 50, west: 170, north: 51, east: -170 }), false);
});
test("Google Maps uses the exact coordinates and the documented API URL", () => {
  const url = new URL(googleMapsUrl(place));
  assert.equal(url.hostname, "www.google.com");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("query"), "52.52,13.405");
});
test("distance calculation handles equal points and known distance", () => {
  assert.equal(distanceKm(place, place), 0);
  assert.ok(Math.abs(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }) - 111.195) < .01);
});
test("visit dates convert local time to UTC and reject invalid or future dates", () => {
  const input = "2025-05-02T15:45";
  assert.equal(visitTimestamp(input), new Date(input).toISOString());
  assert.equal(toLocalDateTime(new Date(input)), input);
  for (const invalid of ["", "invalid", "1999-01-01T00:00", "2099-01-01T00:00"]) assert.throws(() => visitTimestamp(invalid));
});
