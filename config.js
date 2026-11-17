// Public browser configuration. Never put a service_role / secret key here.
export default {
  supabaseUrl: "",
  supabaseKey: "",
  defaultCenter: [52.52, 13.405],
  defaultZoom: 14,
  overpassUrl: "https://ovp.dresel.systems/api/interpreter",
  overpassFallbackUrl: "https://overpass-api.de/api/interpreter",
  geocoderUrl: "https://nominatim.openstreetmap.org/search",
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
};
