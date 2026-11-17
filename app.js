const STORAGE_KEY = "playground-map-v1";
const FALLBACK_PLAYGROUNDS = [
  { id: "fallback-1", name: "Spielplatz Mauerpark", lat: 52.5439, lon: 13.4034, address: "Gleimstraße, Berlin" },
  { id: "fallback-2", name: "Spielplatz Viktoriapark", lat: 52.4883, lon: 13.3819, address: "Viktoria-park, Berlin" },
  { id: "fallback-3", name: "Spielplatz im Treptower Park", lat: 52.4878, lon: 13.4772, address: "Treptower Park, Berlin" }
];

let stored = {};
try {
  stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (!stored || Array.isArray(stored) || typeof stored !== "object") stored = {};
} catch (_error) {
  stored = {};
}
let selected = null;
let playgroundMarkers = [];

const map = L.map("map", { zoomControl: true }).setView([52.52, 13.405], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap-Mitwirkende"
}).addTo(map);

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

function getEntry(id) {
  return stored[id] || { visited: false, visitedAt: null, variety: null, climbability: null, pullups: null };
}

function setEntry(id, update) {
  stored[id] = { ...getEntry(id), ...update };
  saveState();
}

function playgroundName(element) {
  return element.tags?.name || element.tags?.["name:de"] || "Unbenannter Spielplatz";
}

function playgroundAddress(element) {
  const tags = element.tags || {};
  const parts = [tags["addr:street"], tags["addr:housenumber"], tags["addr:postcode"], tags["addr:city"]].filter(Boolean);
  return parts.join(" ") || "Adresse nicht hinterlegt";
}

function markerIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="playground-marker"><span>●</span></div>',
    iconSize: [34, 34],
    iconAnchor: [17, 32],
    popupAnchor: [0, -28]
  });
}

function addPlayground(playground) {
  if (!Number.isFinite(playground.lat) || !Number.isFinite(playground.lon)) return;
  const marker = L.marker([playground.lat, playground.lon], { icon: markerIcon() }).addTo(map);
  marker.bindTooltip(playground.name, { direction: "top", offset: [0, -24] });
  marker.on("click", () => selectPlayground(playground));
  playgroundMarkers.push(marker);
}

function clearMarkers() {
  playgroundMarkers.forEach((marker) => marker.remove());
  playgroundMarkers = [];
}

async function loadPlaygrounds() {
  const center = map.getCenter();
  const radius = Math.min(10000, Math.round(map.getBounds().getNorthWest().distanceTo(center)));
  const query = `[out:json][timeout:15];nwr["leisure"="playground"](around:${radius},${center.lat},${center.lng});out center tags;`;
  showStatus("Spielplätze werden geladen…");

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal
    });
    window.clearTimeout(timeoutId);
    if (!response.ok) throw new Error("Overpass nicht erreichbar");
    const data = await response.json();
    clearMarkers();

    const points = data.elements.slice(0, 300).map((element) => ({
      id: String(element.id),
      name: playgroundName(element),
      lat: element.lat ?? element.center?.lat,
      lon: element.lon ?? element.center?.lon,
      address: playgroundAddress(element)
    }));
    (points.length ? points : FALLBACK_PLAYGROUNDS).forEach(addPlayground);
    showStatus(points.length ? `${points.length} Spielplätze gefunden` : "Keine Spielplätze in diesem Bereich gefunden");
  } catch (_error) {
    clearMarkers();
    FALLBACK_PLAYGROUNDS.forEach(addPlayground);
    showStatus("Offline-Beispielplätze angezeigt");
  }
}

function selectPlayground(playground) {
  selected = playground;
  document.getElementById("empty-state").hidden = true;
  document.getElementById("details").hidden = false;
  document.getElementById("playground-name").textContent = playground.name;
  document.getElementById("playground-address").textContent = playground.address;

  const entry = getEntry(playground.id);
  document.getElementById("visited").checked = Boolean(entry.visited);
  const visitedTime = document.getElementById("visited-time");
  if (entry.visited && entry.visitedAt) {
    visitedTime.textContent = `Besucht am ${new Date(entry.visitedAt).toLocaleString("de-DE")}`;
    visitedTime.hidden = false;
  } else {
    visitedTime.textContent = "";
    visitedTime.hidden = true;
  }
  for (const category of ["variety", "climbability", "pullups"]) {
    updateRatingButtons(category, entry[category]);
  }
}

function makeRatingButtons(category) {
  const container = document.querySelector(`[data-category="${category}"]`);
  container.replaceChildren();
  for (let value = 0; value <= 10; value += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(value);
    button.setAttribute("aria-label", `${value} von 10`);
    button.dataset.value = String(value);
    button.addEventListener("click", () => {
      if (!selected) return;
      setEntry(selected.id, { [category]: value });
      updateRatingButtons(category, value);
    });
    container.append(button);
  }
}

function updateRatingButtons(category, value) {
  document.querySelectorAll(`[data-category="${category}"] button`).forEach((button) => {
    const active = value !== null && Number(button.dataset.value) === Number(value);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function showStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.classList.add("visible");
  window.clearTimeout(showStatus.timeout);
  showStatus.timeout = window.setTimeout(() => status.classList.remove("visible"), 2600);
}

for (const category of ["variety", "climbability", "pullups"]) makeRatingButtons(category);

document.getElementById("visited").addEventListener("change", (event) => {
  if (!selected) return;
  const visitedAt = event.target.checked ? new Date().toISOString() : null;
  setEntry(selected.id, { visited: event.target.checked, visitedAt });
  const visitedTime = document.getElementById("visited-time");
  if (visitedAt) {
    visitedTime.textContent = `Besucht am ${new Date(visitedAt).toLocaleString("de-DE")}`;
    visitedTime.hidden = false;
  } else {
    visitedTime.textContent = "";
    visitedTime.hidden = true;
  }
  showStatus(event.target.checked ? "Besuch mit Uhrzeit gespeichert" : "Besuch entfernt");
});

document.getElementById("maps-link").addEventListener("click", () => {
  if (!selected) return;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.name} ${selected.address}`)}&query_place_id=`;
  window.open(url, "_blank", "noopener,noreferrer");
});

document.getElementById("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.getElementById("search-input").value.trim();
  if (!query) return;
  showStatus("Ort wird gesucht…");
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
    if (!response.ok) throw new Error("Suche fehlgeschlagen");
    const results = await response.json();
    if (!results.length) {
      showStatus("Ort nicht gefunden");
      return;
    }
    map.setView([Number(results[0].lat), Number(results[0].lon)], 14);
  } catch (_error) {
    showStatus("Ortssuche nicht verfügbar");
  }
});

let loadTimeout;
map.on("moveend", () => {
  window.clearTimeout(loadTimeout);
  loadTimeout = window.setTimeout(loadPlaygrounds, 500);
});

loadPlaygrounds();
