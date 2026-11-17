import config from "./config.js";
import { SharedStore, loadPlaces, searchCity } from "./lib/api.js";
import { CATEGORIES, score, distanceKm, googleMapsUrl, boundsAllowed, toLocalDateTime, visitTimestamp, validPlace } from "./lib/model.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (name, extra = "") => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const decimal = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateLabel = (value) => dateFormat.format(new Date(value));
const storagePrefix = `playground-atlas:${new URL(".", location.href).pathname}:`;
const readLocal = (key) => { try { return JSON.parse(localStorage.getItem(storagePrefix + key)); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); } catch { /* The map also works without local caching. */ } };

let store;
try { store = new SharedStore(config); } catch (error) { showToast(error.message, true); store = new SharedStore({}); }
let areaPlaces = [], sharedPlaces = new Map(), visits = new Map(), markers = new Map();
let filter = "all", view = "area", selectedId = null, sort = "distance", showFitness = true;
let map, markerLayer, loadingArea = false, loadingShared = false, sharedLoaded = false, writeBusy = false;
let ratingDirty = false, ratingDraft = null, querySequence = 0, toastTimer, lastCitySearch = 0, pendingVisit = null;
let referencePoint = { latitude: config.defaultCenter[0], longitude: config.defaultCenter[1] };

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 9000 : 4500);
}

function readableError(error, shared = false) {
  const extra = shared ? " Falls Supabase pausiert ist, das Projekt im Dashboard reaktivieren." : "";
  if (error.name === "TimeoutError" || error.name === "AbortError") return `Die Anfrage dauert zu lange. Bitte erneut versuchen.${extra}`;
  if (error instanceof TypeError) return `Der Dienst ist nicht erreichbar. Bitte die Internetverbindung prüfen.${extra}`;
  return error.message || "Das hat nicht geklappt. Bitte erneut versuchen.";
}

function setSyncState(state) {
  const button = $("#sync-button");
  button.classList.toggle("connected", state === "connected");
  button.classList.toggle("error", state === "error");
  $("#sync-label").textContent = ({ setup: "Speicher einrichten", loading: "Wird synchronisiert …", connected: "Gemeinsam gespeichert", error: "Verbindung prüfen" })[state];
  button.title = state === "setup" ? "Gemeinsamen Speicher einrichten" : "Gemeinsamen Speicher und Synchronisierung öffnen";
}

function canWrite() { return store.ready && sharedLoaded && !writeBusy; }
function findPlace(id) { return sharedPlaces.get(id) ?? areaPlaces.find(p => p.id === id); }
function placeVisits(id) { return visits.get(id) ?? []; }

function render() {
  if (!map) return;
  const places = (view === "area" ? areaPlaces.map(p => findPlace(p.id)) : [...sharedPlaces.values()]).filter(p => showFitness || p.kind !== "fitness_station");
  $("#stat-total").textContent = places.length;
  $("#stat-visited").textContent = places.filter(p => placeVisits(p.id).length).length;
  $("#stat-rated").textContent = places.filter(p => score(p) !== null).length;
  let visible = places.filter(p => filter === "all" || (filter === "unvisited" && !placeVisits(p.id).length) || (filter === "visited" && placeVisits(p.id).length) || (filter === "rated" && score(p) !== null));
  visible.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "de");
    if (sort === "rating") return (score(b) ?? -1) - (score(a) ?? -1) || a.name.localeCompare(b.name, "de");
    return distanceKm(referencePoint, a) - distanceKm(referencePoint, b);
  });
  $("#result-count").textContent = `${visible.length} ${visible.length === 1 ? "Spot" : "Spots"}${view === "saved" ? " in der Sammlung" : " gefunden"}`;
  const list = $("#place-list");
  list.innerHTML = visible.length ? visible.map(place => {
    const value = score(place), history = placeVisits(place.id);
    const dist = distanceKm(referencePoint, place);
    const distance = dist < 1 ? `${Math.round(dist * 1000)} m` : `${decimal(dist)} km`;
    return `<button class="place-card ${selectedId === place.id ? "selected" : ""}" data-place="${escape(place.id)}" aria-label="${escape(place.name)} öffnen" aria-pressed="${selectedId === place.id}">
      <div class="card-top"><span class="place-type">${icon(place.kind === "fitness_station" ? "bar" : "swing")}${place.kind === "fitness_station" ? "FITNESS & CALISTHENICS" : "SPIELPLATZ"}</span><span class="distance">${distance}</span></div>
      <h3>${escape(place.name)}</h3>${icon("arrow", "card-arrow")}
      <p class="card-subtitle">${escape(place.address || (place.equipment?.length ? place.equipment.slice(0, 2).join(" · ") : "Dein nächster Spot zum Entdecken"))}</p>
      <div class="card-bottom"><span class="visit-badge ${history.length ? "done" : ""}">${icon(history.length ? "check" : "clock")}${history.length ? `Besucht · ${dateLabel(history[0].visited_at)}` : "Noch nicht besucht"}</span><span class="mini-rating ${value === null ? "unrated" : ""}">${value === null ? "Unbewertet" : `${icon("star")}${decimal(value)} <span>/ 10</span>`}</span></div>
    </button>`;
  }).join("") : `<div class="empty-state">${icon(view === "saved" ? "star" : "pin")}<h3>${view === "saved" ? "Hier beginnt eure Sammlung." : filter === "all" ? "Hier ist noch Platz für Neues." : "Noch kein passender Spot."}</h3><p>${view === "saved" ? (store.ready ? "Besuche oder bewerte einen Spielplatz.<br>Er bleibt dann hier für alle gespeichert." : "Verbinde den gemeinsamen Speicher,<br>um eure Sammlung zu starten.") : filter === "all" ? "Verschiebe die Karte oder suche einen Ort.<br>Dann diesen Bereich durchsuchen." : "Probier einen anderen Filter<br>oder entdecke einen neuen Kartenausschnitt."}</p></div>`;
  renderMarkers(visible);
}

function renderMarkers(places) {
  const visibleIds = new Set(places.map(p => p.id));
  // Keep the selected place on the map, even when a filter no longer matches it.
  if (selectedId && findPlace(selectedId)) visibleIds.add(selectedId);
  for (const [id, marker] of markers) if (!visibleIds.has(id)) { markerLayer.removeLayer(marker); markers.delete(id); }
  for (const id of visibleIds) {
    const place = findPlace(id);
    const state = score(place) !== null ? "rated" : placeVisits(id).length ? "visited" : "";
    const markerIcon = L.divIcon({ className: "atlas-marker", html: `<span class="marker-pin ${state} ${id === selectedId ? "selected" : ""}">${icon(placeVisits(id).length ? "check" : place.kind === "fitness_station" ? "bar" : "swing")}</span>`, iconSize: [30, 34], iconAnchor: [15, 33], tooltipAnchor: [0, -34] });
    if (!markers.has(id)) {
      const marker = L.marker([place.latitude, place.longitude], { icon: markerIcon, title: place.name, alt: place.name, keyboard: true });
      const label = document.createElement("span"); label.textContent = place.name;
      marker.bindTooltip(label, { direction: "top" });
      marker.on("click", () => selectPlace(id));
      marker.addTo(markerLayer); markers.set(id, marker);
    } else markers.get(id).setIcon(markerIcon);
    markers.get(id).setZIndexOffset(id === selectedId ? 1000 : 0);
  }
}

function selectPlace(id) {
  if (writeBusy) return;
  selectedId = id; ratingDirty = false; ratingDraft = null; pendingVisit = null;
  $(".workspace").classList.remove("show-list");
  $("#mobile-list-toggle").setAttribute("aria-expanded", "false");
  renderDetail(); render();
  if (markers.has(id) && markerLayer.zoomToShowLayer) markerLayer.zoomToShowLayer(markers.get(id), () => {});
  const place = findPlace(id);
  if (place) {
    const mobile = matchMedia("(max-width:700px)").matches;
    const size = map.getSize();
    if (mobile) map.panTo([place.latitude, place.longitude], { animate: false });
    else if (size.x > 450) map.panInside([place.latitude, place.longitude], { paddingTopLeft: [45, 90], paddingBottomRight: [Math.min(395, size.x * .65), 75], animate: false });
    else map.panTo([place.latitude, place.longitude], { animate: false });
  }
  $("#close-detail")?.focus({ preventScroll: true });
}

function closeDetail() {
  if (writeBusy) return;
  const previous = selectedId;
  selectedId = null; ratingDirty = false; ratingDraft = null;
  $("#detail-panel").hidden = true;
  $(".map-section").classList.remove("details-open");
  render();
  const card = $$('[data-place]').find(el => el.dataset.place === previous);
  card?.focus({ preventScroll: true });
}

function renderDetail() {
  const place = findPlace(selectedId);
  if (!place) return;
  const panel = $("#detail-panel"), value = score(place), history = placeVisits(place.id);
  const draft = ratingDraft ?? (value === null ? { variety: 0, climbability: 0, pull_ups: 0 } : place);
  const writable = canWrite();
  const scrollTop = panel.scrollTop;
  panel.innerHTML = `<div class="detail-cover"><button id="close-detail" class="icon-button" aria-label="Spielplatzdetails schließen" ${writeBusy ? "disabled" : ""}>${icon("close")}</button>
    <div class="eyebrow">${icon(place.kind === "fitness_station" ? "bar" : "swing")} ${place.kind === "fitness_station" ? "FITNESS & CALISTHENICS" : "ZEIT FÜR DRAUSSEN"}</div>
    <h2>${escape(place.name)}</h2><p>${escape(place.address || "Ein neuer Ort für dein nächstes Abenteuer.")}</p>
    <div class="detail-score"><strong>${value === null ? "—" : decimal(value)}</strong><span>/ 10</span><span class="score-label">${value === null ? "Noch unbewertet" : "Gemeinsame Bewertung"}</span></div></div>
    <div class="detail-body"><a class="google-link" href="${googleMapsUrl(place)}" target="_blank" rel="noopener noreferrer">${icon("pin")} In Google Maps öffnen ${icon("external")}</a>
    ${place.equipment?.length || place.access || place.wheelchair ? `<div class="equipment-tags">${(place.equipment ?? []).map(e => `<span>${escape(e)}</span>`).join("")}${place.access === "private" ? "<span>Privater Zugang</span>" : place.access === "customers" ? "<span>Nur für Kundschaft</span>" : ""}${place.wheelchair === "yes" ? "<span>Rollstuhlgerecht laut OSM</span>" : ""}</div>` : ""}
    <section class="detail-section"><h3 class="section-heading">${icon("check")} Schon hier gewesen?</h3><p class="section-caption">Jeder Besuch zählt. Datum und Uhrzeit bleiben erhalten.</p>
    <button id="visit-now" class="button soft full" ${writable ? "" : "disabled"}>${icon("check")} ${writeBusy ? "Wird gespeichert …" : "Jetzt als besucht eintragen"}</button>
    <button id="visit-other" class="visit-other" ${writable ? "" : "disabled"}>Anderes Datum & Uhrzeit eintragen</button>
    <form id="visit-form" class="visit-form" hidden><label for="visit-time">Besucht am (lokale Uhrzeit)</label><input id="visit-time" type="datetime-local" required min="2000-01-01T00:00" max="${toLocalDateTime()}" value="${toLocalDateTime()}"><button class="button primary" type="submit">Besuch speichern</button></form>
    ${history.length ? `<ul class="visit-history">${history.slice(0, 5).map(v => `<li>${icon("clock")}<time datetime="${escape(v.visited_at)}">${dateLabel(v.visited_at)}</time><small>Besucht</small></li>`).join("")}</ul>${history.length > 5 ? `<p class="last-updated">${history.length} Besuche insgesamt · die letzten 5 angezeigt</p>` : ""}` : ""}</section>
    <form id="rating-form" class="detail-section"><h3 class="section-heading">${icon("star")} Wie gut ist dieser Spot?</h3><p class="section-caption">Eine gemeinsame Bewertung. Drei Perspektiven.<br>0 = gar nicht möglich · 10 = ausgezeichnet</p>
    ${CATEGORIES.map(category => `<label class="rating-field" for="rating-${category.key}" title="${category.description}"><span class="rating-label">${icon(category.icon)} ${category.label}<output id="output-${category.key}" for="rating-${category.key}">${draft[category.key]}</output></span><input id="rating-${category.key}" name="${category.key}" aria-label="${category.label}" type="range" min="0" max="10" step="1" value="${draft[category.key]}" ${writeBusy ? "disabled" : ""}><span class="rating-ticks"><span>0</span><span>5</span><span>10</span></span></label>`).join("")}
    <button id="save-rating" type="submit" class="button primary full" ${writable ? "" : "disabled"}>${icon("check")} ${writeBusy ? "Wird gespeichert …" : value === null ? "Bewertung speichern" : "Bewertung aktualisieren"}</button>
    ${!store.ready ? '<p class="storage-hint"><button type="button" id="detail-setup">Gemeinsamen Speicher verbinden</button>, um Besuche und Bewertungen zu speichern.</p>' : !sharedLoaded ? '<p class="storage-hint">Der gemeinsame Speicher ist noch nicht erreichbar. Bitte die Verbindung prüfen und aktualisieren.</p>' : '<p class="last-updated">Für alle sichtbar · Änderungen ersetzen die bisherige Bewertung.</p>'}
    ${place.rated_at ? `<p class="last-updated">Zuletzt bewertet am ${dateLabel(place.rated_at)}</p>` : ""}</form></div>`;
  panel.hidden = false;
  panel.scrollTop = scrollTop;
  $(".map-section").classList.add("details-open");
  $("#close-detail").addEventListener("click", closeDetail);
  $("#detail-setup")?.addEventListener("click", openSetup);
  $("#visit-now").addEventListener("click", () => saveVisit());
  $("#visit-other").addEventListener("click", () => { $("#visit-form").hidden = !$("#visit-form").hidden; if (!$("#visit-form").hidden) $("#visit-time").focus(); });
  $("#visit-form").addEventListener("submit", event => { event.preventDefault(); try { saveVisit(visitTimestamp($("#visit-time").value)); } catch (error) { showToast(error.message, true); } });
  CATEGORIES.forEach(({ key }) => $(`#rating-${key}`).addEventListener("input", event => {
    $(`#output-${key}`).value = event.target.value;
    ratingDirty = true;
    ratingDraft = Object.fromEntries(CATEGORIES.map(({ key }) => [key, Number($(`#rating-${key}`).value)]));
  }));
  $("#rating-form").addEventListener("submit", saveRating);
}

async function saveRating(event) {
  event.preventDefault();
  if (!canWrite()) return;
  const place = findPlace(selectedId);
  const rating = Object.fromEntries(CATEGORIES.map(({ key }) => [key, Number($(`#rating-${key}`).value)]));
  ratingDraft = rating;
  writeBusy = true; renderDetail();
  try {
    const saved = await store.saveRating(place, rating);
    if (!validPlace(saved)) throw new Error("Die Datenbank hat die gespeicherte Bewertung nicht bestätigt. Bitte aktualisieren.");
    sharedPlaces.set(place.id, saved);
    ratingDirty = false; ratingDraft = null; setSyncState("connected");
    showToast("Bewertung für alle gespeichert.");
  } catch (error) { setSyncState("error"); showToast(readableError(error, true), true); }
  finally { writeBusy = false; render(); renderDetail(); }
}

async function saveVisit(timestamp) {
  if (!canWrite()) return;
  const place = findPlace(selectedId);
  // Reuse the UUID on retry after a lost response: one visit, even if it reached the server.
  if (!pendingVisit || pendingVisit.placeId !== place.id || (timestamp && pendingVisit.timestamp !== timestamp)) pendingVisit = { placeId: place.id, timestamp: timestamp ?? new Date().toISOString(), id: crypto.randomUUID() };
  writeBusy = true; renderDetail();
  try {
    const visit = await store.addVisit(place, pendingVisit.timestamp, pendingVisit.id);
    if (!sharedPlaces.has(place.id)) sharedPlaces.set(place.id, place);
    const history = placeVisits(place.id).filter(v => v.id !== visit.id);
    history.push(visit); history.sort((a, b) => b.visited_at.localeCompare(a.visited_at)); visits.set(place.id, history);
    pendingVisit = null; setSyncState("connected"); showToast("Besuch mit Datum und Uhrzeit für alle gespeichert.");
  } catch (error) { setSyncState("error"); showToast(readableError(error, true), true); }
  finally { writeBusy = false; render(); renderDetail(); }
}

async function syncShared({ announce = false } = {}) {
  if (!store.ready || loadingShared || writeBusy) return;
  loadingShared = true; setSyncState("loading");
  const refreshButton = $("#refresh-data"); refreshButton.disabled = true;
  try {
    const snapshot = await store.load();
    if (writeBusy) return; // Don't overwrite a concurrently started write with an earlier read.
    sharedPlaces = new Map(snapshot.places.map(p => [p.id, p]));
    const nextVisits = new Map();
    for (const visit of snapshot.visits) {
      if (!Number.isFinite(Date.parse(visit.visited_at))) continue;
      if (!nextVisits.has(visit.playground_id)) nextVisits.set(visit.playground_id, []);
      nextVisits.get(visit.playground_id).push(visit);
    }
    for (const history of nextVisits.values()) history.sort((a, b) => b.visited_at.localeCompare(a.visited_at));
    visits = nextVisits; sharedLoaded = true;
    setSyncState("connected"); render();
    if (selectedId && !ratingDirty) renderDetail();
    if (announce) showToast("Gemeinsame Daten sind auf dem neuesten Stand.");
  } catch (error) { setSyncState("error"); if (announce || !sharedLoaded) showToast(readableError(error, true), true); }
  finally { loadingShared = false; refreshButton.disabled = false; }
}

function getBounds() {
  const b = map.getBounds();
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}

async function searchArea({ initial = false } = {}) {
  if (loadingArea) return;
  const bounds = getBounds();
  if (!boundsAllowed(bounds)) { showToast("Bitte näher heranzoomen, um die Spielplätze in diesem Bereich zu laden.", true); return; }
  const sequence = ++querySequence;
  loadingArea = true;
  $("#search-area").disabled = true; $("#search-area").classList.add("loading");
  $("#search-area span").textContent = "Spots werden gesucht …";
  $("#list-error").hidden = true;
  if (!areaPlaces.length && view === "area") $("#place-list").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  const cached = initial ? readLocal("area-cache") : null;
  try {
    const cacheMatches = cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000 && cached.bounds?.south <= bounds.south && cached.bounds?.west <= bounds.west && cached.bounds?.north >= bounds.north && cached.bounds?.east >= bounds.east && Array.isArray(cached.places) && cached.places.every(validPlace);
    const places = cacheMatches ? cached.places : await loadPlaces(bounds, [config.overpassUrl, config.overpassFallbackUrl].filter(Boolean));
    if (sequence !== querySequence) return;
    areaPlaces = places;
    if (!cacheMatches) writeLocal("area-cache", { fetchedAt: Date.now(), bounds, places });
    const center = map.getCenter(); referencePoint = { latitude: center.lat, longitude: center.lng };
    render();
    if (!initial) showToast(`${places.length} Spots in diesem Bereich geladen.`);
  } catch (error) {
    $("#list-error").textContent = `${readableError(error)}${areaPlaces.length ? " Die bisherigen Orte bleiben sichtbar." : " Klicke zum Wiederholen auf „Diesen Bereich durchsuchen“."}`;
    $("#list-error").hidden = false;
    render(); showToast("Die Spielplatzsuche ist gerade nicht erreichbar. Du kannst den Bereich erneut durchsuchen.", true);
  } finally {
    loadingArea = false; $("#search-area").disabled = false; $("#search-area").classList.remove("loading");
    $("#search-area span").textContent = "Diesen Bereich durchsuchen";
  }
}

function openSetup() { $("#setup-dialog").showModal(); }

$("#sync-button").addEventListener("click", openSetup);
$("#setup-nudge-button").addEventListener("click", openSetup);
$("#info-button").addEventListener("click", () => $("#about-dialog").showModal());
$$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
$$('dialog').forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
$("#refresh-data").addEventListener("click", () => syncShared({ announce: true }));
$("#search-area").addEventListener("click", () => searchArea());
$("#place-list").addEventListener("click", event => { const card = event.target.closest("[data-place]"); if (card) selectPlace(card.dataset.place); });
$$('[data-filter]').forEach(button => button.addEventListener("click", () => {
  filter = button.dataset.filter;
  $$('[data-filter]').forEach(b => { b.classList.toggle("active", b === button); b.setAttribute("aria-pressed", String(b === button)); });
  render();
}));
$$('[data-view]').forEach(button => button.addEventListener("click", () => {
  view = button.dataset.view;
  $$('[data-view]').forEach(b => { b.classList.toggle("active", b === button); b.setAttribute("aria-pressed", String(b === button)); });
  render();
  if (view === "saved" && sharedPlaces.size) {
    const coords = [...sharedPlaces.values()].filter(p => showFitness || p.kind !== "fitness_station").map(p => [p.latitude, p.longitude]);
    if (coords.length) map.fitBounds(coords, { padding: [50, 80], maxZoom: 15, animate: false });
  }
}));
$("#sort-select").addEventListener("change", event => { sort = event.target.value; render(); });
$("#fitness-input").addEventListener("change", event => { showFitness = event.target.checked; render(); });
$("#mobile-list-toggle").setAttribute("aria-expanded", "false");
$("#mobile-list-toggle").addEventListener("click", () => {
  const showing = $(".workspace").classList.toggle("show-list");
  $("#mobile-list-toggle").setAttribute("aria-expanded", String(showing));
  $("#mobile-list-toggle").setAttribute("aria-label", showing ? "Karte anzeigen" : "Liste anzeigen");
  $("#mobile-list-toggle").innerHTML = `${icon(showing ? "pin" : "list")}<span>${showing ? "Karte anzeigen" : "Liste anzeigen"}</span>`;
});
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("dialog[open]")) closeDetail(); });

$("#city-form").addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("#city-input").value.trim();
  if (query.length < 2 || Date.now() - lastCitySearch < 1100 || loadingArea) return;
  lastCitySearch = Date.now(); $("#city-submit").disabled = true;
  try {
    const results = await searchCity(query, config.geocoderUrl);
    const container = $("#city-results"); container.replaceChildren();
    if (!results.length) { container.hidden = true; showToast("Kein Ort gefunden. Versuch es mit einem anderen Namen."); return; }
    for (const result of results) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = result.display_name;
      button.addEventListener("click", () => {
        if (loadingArea) { showToast("Bitte warten, bis die laufende Gebietssuche abgeschlossen ist."); return; }
        container.hidden = true; $("#city-input").value = "";
        $("#area-label").textContent = result.display_name.split(",").slice(0, 2).join(",");
        // Use a consistent neighbourhood-sized viewport instead of querying whole regions.
        map.setView([Number(result.lat), Number(result.lon)], 14, { animate: false });
        searchArea();
      });
      container.append(button);
    }
    container.hidden = false;
  } catch (error) { showToast(readableError(error), true); }
  finally { $("#city-submit").disabled = false; }
});

$("#location-button").addEventListener("click", () => {
  if (loadingArea) { showToast("Bitte die laufende Gebietssuche abwarten."); return; }
  if (!navigator.geolocation) { showToast("Dein Browser unterstützt die Standortsuche nicht. Nutze die Ortssuche.", true); return; }
  $("#location-button").disabled = true;
  navigator.geolocation.getCurrentPosition(position => {
    $("#location-button").disabled = false;
    const { latitude, longitude } = position.coords;
    map.setView([latitude, longitude], 15, { animate: false });
    $("#area-label").textContent = "In deiner Nähe"; searchArea();
  }, () => { $("#location-button").disabled = false; showToast("Standort nicht verfügbar oder nicht freigegeben. Du kannst stattdessen nach einer Stadt suchen.", true); }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
});

$("#export-button").addEventListener("click", () => {
  if (!sharedLoaded) { showToast("Bitte zuerst den gemeinsamen Speicher verbinden und laden."); return; }
  const data = { version: 1, exportedAt: new Date().toISOString(), source: "Playground Atlas / OpenStreetMap", places: [...sharedPlaces.values()], visits: [...visits.values()].flat() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `playground-atlas-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); showToast("Zuletzt geladenen Stand als JSON exportiert.");
});

function init() {
  if (!window.L) {
    $("#list-error").textContent = "Die Kartenbibliothek konnte nicht geladen werden. Bitte Seite neu laden."; $("#list-error").hidden = false;
    $("#search-area").disabled = true; return;
  }
  const savedView = readLocal("map-view");
  const validView = savedView && Array.isArray(savedView.center) && savedView.center.length === 2 && savedView.center.every(Number.isFinite) && Math.abs(savedView.center[0]) < 85 && Math.abs(savedView.center[1]) <= 180 && Number.isFinite(savedView.zoom) && savedView.zoom >= 3 && savedView.zoom <= 19;
  map = L.map("map", { zoomControl: true, minZoom: 3, maxZoom: 19, worldCopyJump: true }).setView(validView ? savedView.center : config.defaultCenter, validView ? savedView.zoom : config.defaultZoom);
  if (validView) $("#area-label").textContent = "Dein letzter Kartenausschnitt";
  const tileLayer = L.tileLayer(config.tileUrl, { attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>', maxZoom: 19 });
  let tileErrorShown = false;
  tileLayer.on("tileerror", () => { if (!tileErrorShown) { tileErrorShown = true; $("#map-notice").textContent = "Hintergrundkarte nicht erreichbar. Die Spielplatzsuche und Einträge sind weiterhin nutzbar."; $("#map-notice").hidden = false; } });
  tileLayer.addTo(map);
  markerLayer = L.markerClusterGroup ? L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 43, animate: !matchMedia("(prefers-reduced-motion:reduce)").matches,
    iconCreateFunction: cluster => L.divIcon({ className: "atlas-cluster", html: `<span aria-label="${cluster.getChildCount()} Spots, zum Vergrößern anklicken">${cluster.getChildCount()}</span>`, iconSize: [38, 38] })
  }).addTo(map) : L.layerGroup().addTo(map);
  map.on("moveend", () => { const center = map.getCenter(); writeLocal("map-view", { center: [center.lat, center.lng], zoom: map.getZoom() }); });
  new ResizeObserver(() => map.invalidateSize()).observe($("#map"));
  new ResizeObserver(() => document.documentElement.style.setProperty("--list-top", `${$(".sidebar-intro").getBoundingClientRect().bottom}px`)).observe($(".sidebar-intro"));
  $("#setup-nudge").hidden = store.ready;
  $("#setup-instructions").hidden = store.ready;
  $("#connected-info").hidden = !store.ready;
  $("#refresh-data").disabled = !store.ready;
  setSyncState(store.ready ? "loading" : "setup");
  render(); searchArea({ initial: true }); syncShared();
  setInterval(() => { if (!document.hidden) syncShared(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncShared(); });
}
init();
