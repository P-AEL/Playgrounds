import { boundsAllowed, fromOverpass, overpassQuery, validPlace, validRating } from "./model.js";

export async function jsonRequest(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, { ...options, signal: options.signal ?? AbortSignal.timeout(35000) });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error("Der Datenbankzugriff wurde abgelehnt. Bitte öffentlichen Key und Datenbank-Einrichtung prüfen.");
    if (response.status === 429) throw new Error("Zu viele Anfragen. Bitte kurz warten und erneut versuchen.");
    if ([502, 503, 521, 522, 530].includes(response.status)) throw Object.assign(new Error("Der Dienst ist gerade nicht erreichbar oder ausgelastet. Bitte später erneut versuchen."), { status: response.status });
    throw new Error(`Der Dienst meldet einen Fehler (${response.status}). Bitte erneut versuchen.`);
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
  if (result.remark) throw new Error("Die Kartensuche konnte nicht vollständig ausgeführt werden. Bitte einen kleineren Ausschnitt wählen oder später erneut versuchen.");
  if (!Array.isArray(result.elements)) throw new Error("Die Kartensuche hat ungültige Daten zurückgegeben.");
    const places = fromOverpass(result.elements);
    // Regional mirrors can return no data outside their coverage; try global.
    if (places.length || index === endpoints.length - 1) return places;
   } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error("Kein Kartendienst verfügbar.");
}

export async function searchCity(query, endpoint, fetcher = fetch) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "5", "accept-language": "de" });
  return jsonRequest(url, {}, fetcher);
}

function checkConfiguration(config) {
  if (!config.supabaseUrl || !config.supabaseKey) return false;
  const url = new URL(config.supabaseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Die Supabase-URL muss HTTPS verwenden.");
  if (config.supabaseKey.startsWith("sb_secret_")) throw new Error("Ein geheimer Schlüssel darf nicht im Browser verwendet werden.");
  if (!config.supabaseKey.startsWith("sb_publishable_")) {
    try {
      const payload = JSON.parse(atob(config.supabaseKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role !== "anon") throw new Error();
    } catch { throw new Error("Bitte einen öffentlichen Supabase-Publishable- oder Anon-Key verwenden."); }
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
    if (!this.ready) throw new Error("Der gemeinsame Speicher ist noch nicht eingerichtet.");
    try {
      return await jsonRequest(`${this.url}/rest/v1/${path}`, { ...options, headers: { ...this.headers, ...options.headers } }, this.fetcher);
    } catch (error) {
      if (error.status >= 500) throw new Error(`${error.message} Falls Supabase pausiert ist, das Projekt im Dashboard reaktivieren.`);
      throw error;
    }
  }

  async allRows(table, select, order) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const params = new URLSearchParams({ select, order, limit: "1000", offset: String(offset) });
      const page = await this.request(`${table}?${params}`);
      if (!Array.isArray(page)) throw new Error("Die Datenbank hat ungültige Daten zurückgegeben.");
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
    if (!validPlace(place) || !validRating(rating)) throw new Error("Die Bewertung muss in allen drei Kategorien zwischen 0 und 10 liegen.");
    return this.request("rpc/save_playground_rating", {
      method: "POST", body: JSON.stringify({ p_place: place, p_variety: rating.variety, p_climbability: rating.climbability, p_pull_ups: rating.pull_ups })
    });
  }

  async addVisit(place, timestamp, id = crypto.randomUUID()) {
    if (!validPlace(place)) throw new Error("Ungültiger Spielplatz.");
    await this.request("rpc/record_playground_visit", {
      method: "POST", body: JSON.stringify({ p_place: place, p_visited_at: timestamp, p_visit_id: id })
    });
    return { id, playground_id: place.id, visited_at: timestamp };
  }
}

export { boundsAllowed };
