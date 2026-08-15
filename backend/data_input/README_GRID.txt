national_grid — how the "analyze any area" feature works
========================================================

When a user uploads an AREA polygon (Shapefile ZIP / GeoJSON / KML / KMZ / GPKG),
the backend reprojects it to lon/lat, finds the national-grid cells INSIDE it, and
runs Eas_EV.net on those cells → suitability + XAI + station recommendation.

For that, the server needs a compact national grid here:
    backend/data_input/national_grid.parquet     (built from your pipeline output)

BUILD IT ONCE (from the 'Eas_EV WEBAPP' folder):
    python make_webapp_grid.py --national "PATH/TO/output/stage2/national/national_enriched.csv"

This samples your huge national_enriched.csv down to ~120k feature-rich cells and
writes national_grid.parquet (small, ~15-30 MB). Then restart the backend.

Notes
- Uploads may be in any CRS; the server reprojects them (needs pyproj — in requirements).
- A user file that ALREADY has the model's feature columns is scored directly (no grid needed).
- Without this grid file, a bare boundary polygon can't be scored (the server returns a
  clear message asking you to build it).
