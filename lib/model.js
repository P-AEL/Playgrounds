export const CATEGORIES = [
  { key: "variety", label: "Variety", description: "How much variety does this spot offer?", icon: "grid" },
  { key: "climbability", label: "Climbability", description: "How good is this spot for climbing?", icon: "climb" },
  { key: "pull_ups", label: "Pull ups possibility", description: "How good are the opportunities for pull ups?", icon: "bar" }
];

export function validPlace(place) {
  return place && /^(node|way|relation)\/\d+$/.test(place.id) &&
    typeof place.name === "string" && place.name.length > 0 && place.name.length <= 250 &&
    Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 &&
    Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180;
}

export function validRating(rating) {
  return CATEGORIES.every(({ key }) => Number.isInteger(rating?.[key]) && rating[key] >= 0 && rating[key] <= 10);
}

export function score(rating) {
  return validRating(rating) ? CATEGORIES.reduce((sum, { key }) => sum + rating[key], 0) / 3 : null;
}

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
}

export function googleMapsUrl(place) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${place.latitude},${place.longitude}`);
  return url.href;
}

export function fromOverpass(elements) {
  const equipmentNames = { climbingframe: "Climbing frame", climbing_frame: "Climbing frame", swing: "Swings", slide: "Slide", sandpit: "Sandpit", horizontal_bar: "Pull-up bar", monkey_bars: "Monkey bars", balancebeam: "Balance beam", seesaw: "Seesaw", zipwire: "Zip line", water: "Water play" };
  const places = new Map();
  for (const element of elements ?? []) {
    const tags = element.tags ?? {};
    if (!["playground", "fitness_station"].includes(tags.leisure)) continue;
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    const address = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
    const place = {
      id: `${element.type}/${element.id}`,
      name: String(tags["name:en"] || tags.name || (tags.leisure === "fitness_station" ? "Outdoor gym" : address ? `Playground ${address}` : "Unnamed playground")).slice(0, 250),
      latitude, longitude, address: address.slice(0, 500),
      kind: tags.leisure,
      equipment: [...new Set(Object.entries(equipmentNames).filter(([key]) => tags[`playground:${key}`] === "yes" || tags.playground === key || tags.fitness_station?.split(";").includes(key)).map(([, name]) => name))],
      access: tags.access || "",
      wheelchair: tags.wheelchair || ""
    };
    if (validPlace(place)) places.set(place.id, place);
  }
  return [...places.values()];
}

export function boundsAllowed(bounds) {
  const { south, west, north, east } = bounds;
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east || south < -90 || north > 90 || west < -180 || east > 180) return false;
  const height = distanceKm({ latitude: south, longitude: west }, { latitude: north, longitude: west });
  const width = distanceKm({ latitude: (south + north) / 2, longitude: west }, { latitude: (south + north) / 2, longitude: east });
  return height <= 35 && width <= 35 && height * width <= 650;
}

export function overpassQuery(bounds) {
  if (!boundsAllowed(bounds)) throw new Error("Please zoom in. The search area must not exceed 650 km².");
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].map(n => n.toFixed(6)).join(",");
  return `[out:json][timeout:25];nwr["leisure"~"^(playground|fitness_station)$"](${box});out center tags;`;
}

export function toLocalDateTime(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

export function visitTimestamp(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime()) || date.getTime() < Date.UTC(2000, 0, 1) || date.getTime() > Date.now() + 60000) {
    throw new Error("Please enter a valid date from the year 2000 onwards that is not in the future.");
  }
  return date.toISOString();
}
