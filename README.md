# ⚡ Eas_EV — India EV Intelligence Platform

National AI-GIS platform for EV charging: real station map, smart search, EV-aware trip planner, AI agent, strategic analytics, data export.

## ✨ What's inside

**Real data** — `data/stations.json` holds 1,879 real Indian EV charging stations (cleaned from your dataset: operator, AC/DC, power, connector, pricing, phone, website, availability, address, state). No demo data.

**Map & search** — search any state/district/city/landmark (boundary or radius mode), 5 base maps, scale bar, cumulative radius (growing the radius never hides previous results).

**Universal POI popups** — every station AND amenity has: Get Route (preview only, no trip), Add to Trip, Save, Details, clickable phone/website/email.

**Toggle system** — every layer/category is independent on/off; turning one off never affects others. Clear controls + Reset map. Session persists in localStorage.

**Amenities** — 35+ categories in grouped dropdowns, each a toggle.

**EV-aware trip planner** — multi-stop (reorderable), any POI as a stop, weather-adjusted battery curve, mandatory charging stops searched across the FULL dataset (never "no station"), charging-stop intelligence panel (operator, power, connector, detour, charge time, nearby cafés, call/web), trip action bar (Save / Start / Cancel), full-screen navigation mode with live battery/ETA/next-stop, saved trips library, offline export (JSON/GPX/PDF).

**Strategic Intelligence** — National dashboard (live stats from dataset), area insights, site evaluation with XAI factor bars (accepts coordinates, GeoJSON, KML, or zipped Shapefile upload), dynamic location comparison, investment ROI estimator, scenario simulator, demand forecast slider (2025→2040), state rankings computed from real data, auto report (PDF + DOCX), heatmap studio.

**AI agent** — floating chat (voice + photo identification), searches the full dataset, controls the map live, any language.

**Export** — selected datasets as CSV / GeoJSON / KML / Shapefile (zip with .shp/.shx/.dbf/.prj/.cpg, WGS84, QGIS/ArcGIS compatible).

## 🚀 Run

```bash
cd easev
python -m http.server 8080
# open http://localhost:8080
```
Or in VS Code: right-click index.html → "Open with Live Server".

⚠️ Must run via a local server (not file://) so `data/stations.json` loads.

## 🔑 API keys (optional, in js/config.js)
- `ANTHROPIC_API_KEY` — for the AI agent (local use)
- Everything else (map, search, routing, amenities) needs no key.

## 📁 Structure
```
easev/
├── index.html
├── css/style.css
├── data/stations.json        ← 1,879 real EV stations
├── data/state_summary.json
├── js/  config, utils, poi, shp, map, amenities, trip, intel, agent, download, app
└── backend/  server.py (optional FastAPI proxy)
```

## ⚠️ Note on estimates
Suitability, demand, gap, ROI, forecast and rankings are **heuristic estimates** computed from the loaded station data and live OpenStreetMap amenities — illustrative for planning and academic demonstration, not an officially trained national model or financial advice.
