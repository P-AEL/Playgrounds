// Public browser configuration. Never put database credentials here.
export default {
  apiBaseUrl: "",
  defaultCenter: [55.6761, 12.5683],
  defaultZoom: 14,
  overpassUrl: "https://ovp.dresel.systems/api/interpreter",
  overpassFallbackUrl: "https://overpass-api.de/api/interpreter",
  geocoderUrl: "https://nominatim.openstreetmap.org/search",
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
};
