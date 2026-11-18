import { boundsAllowed, fromOverpass, overpassQuery, validPlace, validRating } from "./model.js";

export async function jsonRequest(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, signal: options.signal ?? AbortSignal.timeout(35000) });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error("Access was denied by the service.");
    if (response.status === 429) throw new Error("Too many requests. Please wait a moment and try again.");
    if ([502, 503, 521, 522, 530].includes(response.status)) throw Object.assign(new Error("The service is unavailable or busy. Please try again later."), { status: response.status });
    throw new Error(`The service returned an error (${response.status}). Please try again.`);
  }
  return response.status === 204 ? null : response.json();
}

export async function loadPlaces(bounds, endpoint, fetcher = fetch) {
  const query = overpassQuery(bounds);
  const endpoints = Array.isArray(endpoint) ? endpoint : [endpoint];
  let lastError;
  for (const [index, candidate] of endpoints.entries()) {
   try {
    const url = new URL(candidate);
    url.searchParams.set("data", query);
    const result = await jsonRequest(url, { signal: AbortSignal.timeout(22000) }, fetcher);
  // Overpass can return HTTP 200 with an incomplete result and a runtime error.
  if (result.remark) throw new Error("The map search could not be completed. Please select a smaller area or try again later.");
  if (!Array.isArray(result.elements)) throw new Error("The map search returned invalid data.");
    const places = fromOverpass(result.elements);
    // Regional mirrors can return no data outside their coverage; try global.
    if (places.length || index === endpoints.length - 1) return places;
   } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error("No map service is available.");
}

export async function searchCity(query, endpoint, fetcher = fetch) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "5", "accept-language": "en" });
  return jsonRequest(url, {}, fetcher);
}

function apiBaseUrl(config) {
  if (!config.apiBaseUrl) return null;
  let url;
  try { url = new URL(config.apiBaseUrl, globalThis.location?.href); }
  catch { throw new Error("Set a valid backend API URL."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("The API URL must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("The public API URL must not contain credentials or query parameters.");
  return url.href.replace(/\/$/, "");
}

export async function waitForBackend(url, fetcher = fetch, {
  timeoutMs = 90000, retryDelayMs = 2000,
  now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      const response = await fetcher(`${url}/api/atlas?resource=health`, {
        credentials: "omit", signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - now())))
      });
      if (!response.ok && response.status < 500 && ![408, 425].includes(response.status)) {
        throw Object.assign(new Error(`The backend rejected the connection (${response.status}).`), { permanent: true });
      }
      // Sleeping Render instances may first return an HTML startup page.
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok" && body.storage === "mongodb") return;
      }
    } catch (error) { if (error.permanent) throw error; }
    const remaining = deadline - now();
    if (remaining > 0) await wait(Math.min(retryDelayMs, remaining));
  }
  throw new Error("Shared storage is taking longer than expected to start. Please try again shortly.");
}

export class SharedStore {
  constructor(config, fetcher = fetch, startupOptions = {}) {
    this.url = apiBaseUrl(config);
    this.ready = Boolean(this.url);
    this.fetcher = fetcher;
    this.startupOptions = startupOptions;
    this.now = startupOptions.now ?? (() => Date.now());
    this.lastAwake = null;
    this.startup = null;
    this.checkStartup = this.ready && new URL(this.url).hostname.endsWith(".onrender.com");
  }

  async ensureAwake() {
    if (!this.checkStartup || (this.lastAwake !== null && this.now() - this.lastAwake < 300000)) return;
    if (!this.startup) {
      this.startup = waitForBackend(this.url, this.fetcher, this.startupOptions)
        .then(() => { this.lastAwake = this.now(); })
        .finally(() => { this.startup = null; });
    }
    return this.startup;
  }

  async request(query = "", body) {
    if (!this.ready) throw new Error("Shared storage has not been set up yet.");
    await this.ensureAwake();
    try {
      const result = await jsonRequest(`${this.url}/api/atlas${query}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        credentials: "omit",
        body: body === undefined ? undefined : JSON.stringify(body)
      }, this.fetcher);
      this.lastAwake = this.now();
      return result;
    } catch (error) { this.lastAwake = null; throw error; }
  }

  async allRows(resource) {
    const rows = [], cursors = new Set();
    let after = null;
    do {
      const params = new URLSearchParams({ resource, limit: "500" });
      if (after) params.set("after", after);
      const page = await this.request(`?${params}`);
      if (!page || !Array.isArray(page.items) || (page.nextCursor !== null && typeof page.nextCursor !== "string")) throw new Error("The database returned invalid data.");
      rows.push(...page.items);
      after = page.nextCursor;
      if (after && cursors.has(after)) throw new Error("The database returned a repeated page cursor.");
      if (after) cursors.add(after);
    } while (after);
    return rows;
  }

  async load() {
    const [places, visits] = await Promise.all([this.allRows("places"), this.allRows("visits")]);
    return { places: places.filter(validPlace), visits };
  }

  async saveRating(place, rating) {
    if (!validPlace(place) || !validRating(rating)) throw new Error("The rating must be between 0 and 10 in all three categories.");
    return this.request("", { action: "rate", place, rating });
  }

  async addVisit(place, timestamp, id = crypto.randomUUID()) {
    if (!validPlace(place)) throw new Error("Invalid playground.");
    const saved = await this.request("", { action: "visit", place, visitedAt: timestamp, visitId: id });
    if (!saved || saved.id !== id || saved.playground_id !== place.id || saved.visited_at !== new Date(timestamp).toISOString()) throw new Error("The database did not confirm the saved visit. Please refresh.");
    return saved;
  }
}

export { boundsAllowed };
