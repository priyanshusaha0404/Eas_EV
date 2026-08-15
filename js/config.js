/* ═══ Eas_EV — config.js ═══
   SECURITY: never ship real API keys in client-side JS (readable in any browser).
   Keep keys blank and use USE_BACKEND_AGENT:true so the server proxy injects them. */
const CONFIG = {
  ANTHROPIC_API_KEY: "",          // ← optional: Anthropic key (paid)
  ANTHROPIC_MODEL: "claude-sonnet-4-6",
  GEMINI_API_KEY: "",             // (optional single key — can leave blank if using the list below)
  GEMINI_API_KEYS: [],  // keep empty in production — use backend proxy
  GEMINI_MODEL: "gemini-2.5-flash",
  USE_BACKEND_AGENT: true,       // ← set TRUE when deployed (uses /api/gemini proxy so keys stay hidden on the server)
  OCM_API_KEY: "",                // ← optional: OpenChargeMap key
  INDIA_CENTER: [22.9734, 78.6569],
  INDIA_ZOOM: 5,
  OSRM: "https://router.project-osrm.org",
  NOMINATIM: "https://nominatim.openstreetmap.org",
  OVERPASS: "https://overpass-api.de/api/interpreter",
  OPEN_METEO: "https://api.open-meteo.com/v1/forecast",
  TYPE_COLORS: { AC:"#4f8ef7", DC:"#ef4444", AC_DC:"#facc15", SWAP:"#22c55e", ULTRA:"#8b5cf6" },
  TYPE_NAMES: { AC:"AC Charger", DC:"DC Charger", AC_DC:"AC + DC Charger", SWAP:"Battery Swap Station" },
  WGS84_WKT: 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
};
