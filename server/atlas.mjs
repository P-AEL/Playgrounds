import { validPlace, validRating } from "../lib/model.js";

export const BODY_LIMIT = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACE_ID = /^(node|way|relation)\/\d+$/;
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function limitedText(value, max, fallback = "") {
  if (value == null) return fallback;
  if (typeof value !== "string" || value.length > max) throw new ApiError(400, "Invalid playground metadata.");
  return value;
}

export function normalizePlace(value) {
  if (!validPlace(value)) throw new ApiError(400, "Invalid playground.");
  const equipment = value.equipment ?? [];
  if (!Array.isArray(equipment) || equipment.length > 30 || equipment.some(item => typeof item !== "string" || item.length > 100)) throw new ApiError(400, "Invalid equipment list.");
  const kind = value.kind ?? "playground";
  if (!["playground", "fitness_station"].includes(kind)) throw new ApiError(400, "Invalid playground type.");
  return {
    id: value.id, name: value.name, latitude: value.latitude, longitude: value.longitude,
    kind, address: limitedText(value.address, 500), equipment,
    access: limitedText(value.access, 100), wheelchair: limitedText(value.wheelchair, 50)
  };
}

function validVisit(value, now) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1) || time > now.getTime() + 60000) throw new ApiError(400, "Enter a valid visit date and time that is not in the future.");
  return new Date(time).toISOString();
}

function publicRecord(record) {
  if (!record) throw new Error("Missing database confirmation.");
  const { _id, _revision, ...data } = record;
  return data;
}

export async function listRecords(db, resource, after, limit = 500) {
  if (!["places", "visits"].includes(resource)) throw new ApiError(400, "Unknown resource.");
  if (after && (resource === "places" ? !/^(node|way|relation)\/\d+$/.test(after) : !UUID.test(after))) throw new ApiError(400, "Invalid page cursor.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ApiError(400, "Invalid page size.");
  const table = resource === "places" ? "playgrounds" : "playground_visits";
  const records = await db.collection(table).find(after ? { _id: { $gt: after } } : {}).sort({ _id: 1 }).limit(limit + 1).toArray();
  const hasMore = records.length > limit;
  const page = records.slice(0, limit);
  return { items: page.map(publicRecord), nextCursor: hasMore ? page.at(-1)._id : null };
}

export async function saveRating(db, value, rating, now = new Date()) {
  const place = normalizePlace(value);
  if (!validRating(rating)) throw new ApiError(400, "Every rating must be an integer from 0 to 10.");
  const record = await db.collection("playgrounds").findOneAndUpdate({ _id: place.id }, {
    $set: { ...place, variety: rating.variety, climbability: rating.climbability, pull_ups: rating.pull_ups, rated_at: now.toISOString() }
  }, { upsert: true, returnDocument: "after" });
  return publicRecord(record);
}

export async function recordVisit(db, value, visitedAt, visitId, now = new Date()) {
  const place = normalizePlace(value);
  if (typeof visitId !== "string" || !UUID.test(visitId)) throw new ApiError(400, "A valid visit ID is required.");
  const timestamp = validVisit(visitedAt, now);
  // Keep the place and its visit together, including during a concurrent removal.
  return transaction(db, async session => {
    await db.collection("playgrounds").updateOne({ _id: place.id }, {
      $set: place, $setOnInsert: { variety: null, climbability: null, pull_ups: null, rated_at: null },
      // Force a write even when metadata is unchanged, so a concurrent delete conflicts.
      $inc: { _revision: 1 }
    }, { upsert: true, session });
    const visit = await db.collection("playground_visits").findOneAndUpdate({ _id: visitId }, {
      $setOnInsert: { id: visitId, playground_id: place.id, visited_at: timestamp, created_at: now.toISOString() }
    }, { upsert: true, returnDocument: "after", session });
    if (visit.playground_id !== place.id || visit.visited_at !== timestamp) throw new ApiError(409, "This visit ID is already used for a different visit.");
    return publicRecord(visit);
  });
}

function transaction(db, operation) {
  return db.client.withSession(session => session.withTransaction(() => operation(session), {
    readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10000
  }));
}

export function normalizeDeletion(value) {
  if (!value || value.confirmed !== true) throw new ApiError(400, "Confirm the deletion first.");
  if (!["visit", "rating", "place"].includes(value.target)) throw new ApiError(400, "Invalid deletion target.");
  if (typeof value.placeId !== "string" || !PLACE_ID.test(value.placeId)) throw new ApiError(400, "Invalid playground ID.");
  if (value.target === "visit" && (typeof value.visitId !== "string" || !UUID.test(value.visitId))) throw new ApiError(400, "A valid visit ID is required.");
  return { target: value.target, placeId: value.placeId, ...(value.target === "visit" ? { visitId: value.visitId } : {}) };
}

export async function deleteEntry(db, value) {
  const deletion = normalizeDeletion(value);
  const { target, placeId, visitId } = deletion;
  if (target === "visit") {
    await db.collection("playground_visits").deleteOne({ _id: visitId, playground_id: placeId });
  } else if (target === "rating") {
    const place = await db.collection("playgrounds").findOneAndUpdate({ _id: placeId }, {
      $set: { variety: null, climbability: null, pull_ups: null, rated_at: null }
    }, { returnDocument: "after" });
    return { deleted: true, ...deletion, place: place ? publicRecord(place) : null };
  } else {
    await transaction(db, async session => {
      await db.collection("playgrounds").deleteOne({ _id: placeId }, { session });
      await db.collection("playground_visits").deleteMany({ playground_id: placeId }, { session });
    });
  }
  return { deleted: true, ...deletion };
}

async function readBody(req) {
  if (Number(req.headers["content-length"]) > BODY_LIMIT) { req.resume?.(); throw new ApiError(413, "Request body is too large."); }
  if (req.body !== undefined) {
    if (Buffer.byteLength(typeof req.body === "string" ? req.body : JSON.stringify(req.body)) > BODY_LIMIT) throw new ApiError(413, "Request body is too large.");
    try { return typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { throw new ApiError(400, "Invalid JSON body."); }
  }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on("data", chunk => {
      if (done) return;
      size += chunk.length;
      if (size > BODY_LIMIT) { done = true; reject(new ApiError(413, "Request body is too large.")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new ApiError(400, "Invalid JSON body.")); }
    });
    req.on("error", () => reject(new ApiError(400, "Unable to read request.")));
  });
}

export function createAtlasHandler({ getDatabase, origins, now = () => new Date() }) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Origin");
    try {
      const allowed = [...(origins ?? (process.env.ALLOWED_ORIGINS || "https://p-ael.github.io").split(",").map(s => s.trim()).filter(Boolean))];
      if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) allowed.push("http://127.0.0.1:4173", "http://localhost:4173");
      const origin = req.headers.origin;
      let sameOrigin = false;
      try { sameOrigin = origin && new URL(origin).host === req.headers.host; } catch { /* Unknown origins are rejected below. */ }
      if (origin && !allowed.includes(origin) && !sameOrigin) throw new ApiError(403, "This site is not allowed to access the API.");
      if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
      if (!["GET", "POST"].includes(req.method)) { res.setHeader("Allow", "GET, POST, OPTIONS"); throw new ApiError(405, "Method not allowed."); }
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET") {
        const resource = url.searchParams.get("resource") || "health";
        if (resource === "health") {
          const db = await getDatabase(); await db.command({ ping: 1 });
          res.end(JSON.stringify({ status: "ok", storage: "mongodb" })); return;
        }
        if (!["places", "visits"].includes(resource)) throw new ApiError(400, "Unknown resource.");
        const result = await listRecords(await getDatabase(), resource, url.searchParams.get("after"), Number(url.searchParams.get("limit") || 500));
        res.end(JSON.stringify(result)); return;
      }
      if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new ApiError(415, "Use application/json.");
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "A JSON object is required.");
      if (body.action === "delete") {
        normalizeDeletion(body);
        const result = await deleteEntry(await getDatabase(), body);
        res.end(JSON.stringify(result)); return;
      }
      if (!["rate", "visit"].includes(body.action)) throw new ApiError(400, "Unknown action.");
      normalizePlace(body.place);
      if (body.action === "rate" && !validRating(body.rating)) throw new ApiError(400, "Every rating must be an integer from 0 to 10.");
      if (body.action === "visit") {
        validVisit(body.visitedAt, now());
        if (typeof body.visitId !== "string" || !UUID.test(body.visitId)) throw new ApiError(400, "A valid visit ID is required.");
      }
      const db = await getDatabase();
      const result = body.action === "rate" ? await saveRating(db, body.place, body.rating, now()) : await recordVisit(db, body.place, body.visitedAt, body.visitId, now());
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof ApiError ? error.status : 503;
      const message = error instanceof ApiError ? error.message : "Shared storage is unavailable. Please try again later.";
      res.end(JSON.stringify({ error: message }));
    }
  };
}
