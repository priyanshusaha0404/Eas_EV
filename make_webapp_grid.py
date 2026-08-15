#!/usr/bin/env python3
"""
make_webapp_grid.py
───────────────────
Build the COMPACT national grid the webapp uses to score an uploaded area.

Your pipeline's national_enriched.csv is huge (millions of rows, GBs) — too big
to load on a web server. This script downsamples it to a small, feature-rich
grid (default ~120k cells) keeping ONLY the columns the model needs + lat/lon +
scenario_category, and writes:

    backend/data_input/national_grid.parquet   (falls back to .csv if pyarrow absent)

After it finishes, restart the backend. Then a user can upload ANY area polygon
(Shapefile ZIP / GeoJSON / KML / KMZ / GPKG) and the model scores the national
grid cells INSIDE that polygon → suitability + XAI + station recommendation.

USAGE (run from inside the 'Eas_EV WEBAPP' folder):
  python make_webapp_grid.py --national "C:/path/to/output/stage2/national/national_enriched.csv"
  # optional: --sample 120000   --webapp .   --model backend/models/easev_net.joblib
"""
import argparse
from pathlib import Path
import numpy as np, pandas as pd, joblib

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--national", required=True, help="path to national_enriched.csv")
    ap.add_argument("--webapp", default=".", help="path to 'Eas_EV WEBAPP' folder (default: current)")
    ap.add_argument("--model", default=None, help="path to easev_net.joblib (default: <webapp>/backend/models/easev_net.joblib)")
    ap.add_argument("--sample", type=int, default=120_000, help="target number of grid cells (default 120000)")
    a = ap.parse_args()

    webapp = Path(a.webapp)
    backend = webapp if webapp.name == "backend" else webapp / "backend"
    model_path = Path(a.model) if a.model else backend / "models" / "easev_net.joblib"
    out_dir = backend / "data_input"; out_dir.mkdir(parents=True, exist_ok=True)

    # 1) which columns does the model actually need?
    b = joblib.load(model_path)
    feats = list(b["features"])
    raw_feats = [f for f in feats if not f.startswith("scn_")]          # scn_* derived from scenario_category
    print(f"model needs {len(feats)} features ({len(raw_feats)} raw + scenario one-hot)")

    # 2) figure out which of those columns exist in the CSV header
    header = pd.read_csv(a.national, nrows=0)
    have = set(header.columns)
    def pick(cands):
        return next((c for c in header.columns if c.lower() in cands), None)
    latc = pick({"lat", "latitude", "y"}); lonc = pick({"lon", "lng", "longitude", "x"})
    if not latc or not lonc:
        raise SystemExit("national_enriched.csv has no lat/lon columns — cannot build the grid.")
    scen = "scenario_category" if "scenario_category" in have else ("scenario" if "scenario" in have else None)
    keep = [latc, lonc] + ([scen] if scen else []) + [f for f in raw_feats if f in have]
    keep = list(dict.fromkeys(keep))   # unique, ordered
    print(f"keeping {len(keep)} columns; lat='{latc}' lon='{lonc}' scenario='{scen}'")

    # 3) count rows (one quick pass) to compute a sampling fraction
    print("counting rows …")
    total = sum(1 for _ in open(a.national, encoding="utf-8", errors="ignore")) - 1
    frac = min(1.0, a.sample / max(1, total))
    print(f"national rows: {total:,}  → sampling fraction {frac:.4f}")

    # 4) chunked read (only needed cols) + per-chunk sample → bounded memory
    parts, rng = [], np.random.RandomState(42)
    reader = pd.read_csv(a.national, usecols=keep, chunksize=250_000)
    for i, ch in enumerate(reader, 1):
        ch = ch.dropna(subset=[latc, lonc])
        if frac < 1.0 and len(ch):
            ch = ch.sample(frac=frac, random_state=rng.randint(1 << 30))
        parts.append(ch)
        print(f"  chunk {i}: kept {len(ch):,} (running {sum(len(p) for p in parts):,})")
    grid = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=keep)

    # 5) tidy: standard coord names, float32 to shrink
    grid = grid.rename(columns={latc: "lat", lonc: "lon"})
    if scen and scen != "scenario_category":
        grid = grid.rename(columns={scen: "scenario_category"})
    for c in grid.columns:
        if c not in ("scenario_category",) and grid[c].dtype.kind in "fc":
            grid[c] = grid[c].astype("float32")
    print(f"final grid: {len(grid):,} cells × {grid.shape[1]} cols")

    # 6) write parquet (preferred) or CSV
    pq = out_dir / "national_grid.parquet"; csv = out_dir / "national_grid.csv"
    wrote = None
    try:
        grid.to_parquet(pq, index=False); wrote = pq
        if csv.exists(): csv.unlink()
    except Exception as e:
        print(f"  (parquet unavailable: {type(e).__name__} — writing CSV instead; consider `pip install pyarrow`)")
        grid.to_csv(csv, index=False); wrote = csv
    size = wrote.stat().st_size / 1048576
    print(f"\n✓ wrote {wrote}  ({size:.1f} MB)")
    print("  Restart the backend. Now upload any area polygon in the .net tab to score it.")

if __name__ == "__main__":
    main()
