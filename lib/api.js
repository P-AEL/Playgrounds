import { boundsAllowed, fromOverpass, overpassQuery, validPlace, validRating } from "./model.js";

export async function jsonRequest(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, signal: options.signal ?? AbortSignal.timeout(35000) });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error("Database access was denied. Please check the public key and database setup.");
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

function checkConfiguration(config) {
  if (!config.supabaseUrl || !config.supabaseKey) return false;
  const url = new URL(config.supabaseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("The Supabase URL must use HTTPS.");
  if (config.supabaseKey.startsWith("sb_secret_")) throw new Error("A secret key must not be used in the browser.");
  if (!config.supabaseKey.startsWith("sb_publishable_")) {
    try {
      const payload = JSON.parse(atob(config.supabaseKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") throw new Error();
    } catch { throw new Error("Please use a public Supabase publishable or anon key."); }
  }
  return true;
}

export class SharedStore {
  constructor(config, fetcher = fetch) {
    this.ready = checkConfiguration(config);
    this.url = config.supabaseUrl?.replace(/\/$/, "");
    this.key = config.supabaseKey;
    this.fetcher = fetcher;
    this.headers = { apikey: this.key, "Content-Type": "application/json" };
    // Publishable keys are API keys, not JWT bearer tokens.
    if (this.key && !this.key.startsWith("sb_publishable_")) this.headers.Authorization = `Bearer ${this.key}`;
  }

  async request(path, options = {}) {
    if (!this.ready) throw new Error("Shared storage has not been set up yet.");
    try {
      return await jsonRequest(`${this.url}/rest/v1/${path}`, { ...options, headers: { ...this.headers, ...options.headers } }, this.fetcher);
    } catch (error) {
      if (error.status >= 500) throw new Error(`${error.message} If Supabase is paused, resume the project in the dashboard.`);
      throw error;
    }
  }

  async allRows(table, select, order) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({ select, order, limit: "1000", offset: String(offset) });
      const page = await this.request(`${table}?${params}`);
      if (!Array.isArray(page)) throw new Error("The database returned invalid data.");
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }

  async load() {
    // Both tables must load successfully before the UI replaces its snapshot.
    const [places, visits] = await Promise.all([
      this.allRows("playgrounds", "*", "id.asc"),
      this.allRows("playground_visits", "id,playground_id,visited_at", "id.asc")
    ]);
    return { places: places.filter(validPlace), visits };
  }

  async saveRating(place, rating) {
    if (!validPlace(place) || !validRating(rating)) throw new Error("The rating must be between 0 and 10 in all three categories.");
    return this.request("rpc/save_playground_rating", {
      method: "POST", body: JSON.stringify({ p_place: place, p_variety: rating.variety, p_climbability: rating.climbability, p_pull_ups: rating.pull_ups })
    });
  }

  async addVisit(place, timestamp, id = crypto.randomUUID()) {
    if (!validPlace(place)) throw new Error("Invalid playground.");
    await this.request("rpc/record_playground_visit", {
      method: "POST", body: JSON.stringify({ p_place: place, p_visited_at: timestamp, p_visit_id: id })
    });
    return { id, playground_id: place.id, visited_at: timestamp };
  }
}

export { boundsAllowed };
