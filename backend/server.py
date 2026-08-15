"""
Eas_EV — backend/server.py
FastAPI server: serves the frontend + API proxies + user authentication.

What lives here
  1. Static frontend hosting (no file:// CORS issues)
  2. /api/gemini      → Gemini proxy   (keys stay server-side, rotated on 429/503)
  3. /api/agent      → Anthropic proxy (key stays server-side)
  4. /api/stations   → OpenChargeMap proxy
  5. /api/net/*      → Eas_EV.net — train, compare & explain ML models,
                        analyse uploaded Shapefiles/GeoJSON with XAI

ALL secrets come from environment variables / the .env file next to this
script. NEVER hard-code keys here — this file goes to GitHub.

Run:
    pip install -r requirements.txt
    uvicorn server:app --reload --port 8000
Then open http://localhost:8000
"""

import io
import json
import os
import zipfile
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# ── .env loader (python-dotenv if installed, tiny fallback otherwise) ─────
BASE = Path(__file__).resolve().parent
try:
    from dotenv import load_dotenv
    load_dotenv(BASE / ".env")
except ImportError:
    env_file = BASE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# ── Config (ALL from environment / .env — see .env.example) ──────────────
OCM_API_KEY       = os.getenv("OCM_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GEMINI_API_KEYS   = [k.strip() for k in os.getenv("GEMINI_API_KEYS", "").split(",") if k.strip()]
GEMINI_MODEL      = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

_gemini_idx = 0
ROOT = BASE.parent
MODELS = BASE / "models"
MODELS.mkdir(exist_ok=True)

app = FastAPI(title="Eas_EV API", version="2.0")

# Always return JSON on unhandled errors (so the frontend never sees a raw
# "Internal Server Error" HTML/text body -> "not valid JSON"). Shows the real
# message + type, which makes upload/model issues debuggable from the UI.
@app.exception_handler(Exception)
async def _json_errors(request: Request, exc: Exception):
    import traceback; traceback.print_exc()
    return JSONResponse(status_code=500,
        content={"error": str(exc) or exc.__class__.__name__, "type": exc.__class__.__name__})


# ══════════════════════ API PROXIES ══════════════════════
@app.get("/api/stations")
async def stations(request: Request):
    """Pass-through to OpenChargeMap with server-side key."""
    params = dict(request.query_params)
    params.setdefault("output", "json")
    params.setdefault("compact", "true")
    params.setdefault("verbose", "false")
    params.setdefault("maxresults", "500")
    if OCM_API_KEY:
        params["key"] = OCM_API_KEY
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get("https://api.openchargemap.io/v3/poi/", params=params)
        return JSONResponse(r.json(), status_code=r.status_code)


@app.post("/api/agent")
async def agent(request: Request):
    """Anthropic Messages proxy — key never reaches the browser."""
    if not ANTHROPIC_API_KEY:
        return JSONResponse({"error": {"message": "Set ANTHROPIC_API_KEY in backend/.env"}}, status_code=400)
    payload = await request.json()
    headers = {"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
               "content-type": "application/json"}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
        return JSONResponse(r.json(), status_code=r.status_code)


@app.post("/api/gemini")
async def gemini(request: Request):
    """Gemini proxy — keys live ONLY in backend/.env, rotated on rate-limit."""
    global _gemini_idx
    if not GEMINI_API_KEYS:
        return JSONResponse({"error": {"message": "Set GEMINI_API_KEYS in backend/.env (comma-separated)"}}, status_code=400)
    payload = await request.json()
    n = len(GEMINI_API_KEYS)
    last = None
    async with httpx.AsyncClient(timeout=120) as client:
        for _ in range(n):
            key = GEMINI_API_KEYS[_gemini_idx % n]
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={key}"
            r = await client.post(url, json=payload, headers={"content-type": "application/json"})
            if r.status_code in (429, 503):
                _gemini_idx = (_gemini_idx + 1) % n
                last = r
                continue
            return JSONResponse(r.json(), status_code=r.status_code)
    return JSONResponse(last.json() if last else {"error": {"message": "all keys exhausted"}},
                        status_code=last.status_code if last else 503)


# ══════════════════════ HEALTH + STATIC ══════════════════════
@app.get("/api/health")
async def health():
    return {"status": "ok", "ocm_key": bool(OCM_API_KEY),
            "anthropic_key": bool(ANTHROPIC_API_KEY), "gemini_keys": len(GEMINI_API_KEYS),
            "net_model": (MODELS / "easev_net.joblib").exists()}




# ══════════════════════ Eas_EV.net — EXPLAINABLE ML ENGINE ══════════════════════
# Stage-4 companion: train several models on an uploaded ML dataset, compare them
# (cross-validated), keep the best as Eas_EV.net, and analyse uploaded Shapefile /
# GeoJSON / CSV areas with per-feature XAI explanations.
#
#   POST /api/net/train    — multipart CSV (grid dataset with a label column)
#   GET  /api/net/status   — model metadata & metrics
#   POST /api/net/analyze  — multipart Shapefile ZIP / GeoJSON / CSV of an area
#   POST /api/net/predict  — JSON feature dict → model score (used by Intel)

import math

try:
    import joblib
    import numpy as np
    import pandas as pd
    from sklearn.ensemble import ExtraTreesClassifier, ExtraTreesRegressor, \
        GradientBoostingClassifier, GradientBoostingRegressor, \
        RandomForestClassifier, RandomForestRegressor
    from sklearn.linear_model import LogisticRegression, Ridge
    from sklearn.model_selection import cross_val_score
    ML_OK = True
except ImportError:
    ML_OK = False

MODEL_PATH = MODELS / "easev_net.joblib"
DATA_INPUT = BASE / "data_input"
DATA_INPUT.mkdir(exist_ok=True)
LABEL_CANDIDATES = ["label", "target", "suitable", "suitability", "class",
                    "y", "station_needed", "is_suitable", "suit_class"]
DROP_COLS = {"id", "cell_id", "hex_id", "uuid", "geometry", "wkt", "lat", "lon",
             "latitude", "longitude", "x", "y_coord", "name", "state", "district",
             "sub_district", "village", "scenario", "study_area", "category"}


def _numeric_frame(df: "pd.DataFrame"):
    keep = [c for c in df.columns if c.lower() not in DROP_COLS]
    num = df[keep].apply(pd.to_numeric, errors="coerce")
    return num.dropna(axis=1, how="all")


def _pick_label(df):
    for c in df.columns:
        if c.lower() in LABEL_CANDIDATES:
            return c
    return None


def _train_frame(df):
    """Shared trainer used by the upload endpoint AND startup auto-train."""
    label = _pick_label(df)
    if not label:
        raise ValueError(f"No label column found. Add one named any of: {', '.join(LABEL_CANDIDATES)}")
    y = pd.to_numeric(df[label], errors="coerce")
    X = _numeric_frame(df.drop(columns=[label]))
    mask = y.notna() & X.notna().any(axis=1)
    X, y = X[mask], y[mask]
    X = X.fillna(X.median(numeric_only=True))
    if len(X) < 40 or X.shape[1] < 2:
        raise ValueError(f"Dataset too small after cleaning ({len(X)} rows x {X.shape[1]} features)")
    classification = y.nunique() <= 10 and (y.round() == y).all()
    task = "classification" if classification else "regression"
    metric = "roc_auc" if (classification and y.nunique() == 2) else ("accuracy" if classification else "r2")
    zoo = ({"Random Forest": RandomForestClassifier(n_estimators=300, n_jobs=-1, random_state=42),
            "Gradient Boosting": GradientBoostingClassifier(random_state=42),
            "Extra Trees": ExtraTreesClassifier(n_estimators=300, n_jobs=-1, random_state=42),
            "Logistic Regression": LogisticRegression(max_iter=2000)}
           if classification else
           {"Random Forest": RandomForestRegressor(n_estimators=300, n_jobs=-1, random_state=42),
            "Gradient Boosting": GradientBoostingRegressor(random_state=42),
            "Extra Trees": ExtraTreesRegressor(n_estimators=300, n_jobs=-1, random_state=42),
            "Ridge": Ridge()})
    comparison, best_name, best_score = [], None, -1e18
    for name, mdl in zoo.items():
        try:
            sc = float(cross_val_score(mdl, X, y, cv=5, scoring=metric).mean())
        except Exception:
            continue
        comparison.append({"model": name, metric: round(sc, 4)})
        if sc > best_score:
            best_score, best_name = sc, name
    if best_name is None:
        raise ValueError("All models failed to train on this dataset")
    best = zoo[best_name].fit(X, y)
    imp = getattr(best, "feature_importances_", None)
    if imp is None:
        imp = np.abs(getattr(best, "coef_", np.zeros((1, X.shape[1])))).ravel()
        imp = imp / (imp.sum() or 1)
    importances = sorted([{"feature": f, "weight": round(float(w), 4)}
                          for f, w in zip(X.columns, imp)], key=lambda d: -d["weight"])
    import datetime
    bundle = {"model": best, "name": best_name, "task": task, "metric": metric,
              "score": round(best_score, 4), "features": list(X.columns),
              "medians": X.median(numeric_only=True).to_dict(),
              "importances": importances, "comparison": comparison,
              "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
              "rows": int(len(X)), "label": label,
              "classes": sorted(y.unique().tolist()) if classification else None}
    joblib.dump(bundle, MODEL_PATH)
    return bundle


@app.on_event("startup")
async def _auto_train():
    """Developer drops the master ML dataset at backend/data_input/dataset.csv —
    the model trains itself on first boot (background thread, non-blocking)."""
    if not ML_OK or MODEL_PATH.exists():
        return
    csvs = sorted(DATA_INPUT.glob("*.csv"))
    if not csvs:
        return
    import threading
    def worker():
        try:
            df = pd.read_csv(csvs[0])
            b = _train_frame(df)
            print(f"[Eas_EV.net] auto-trained from {csvs[0].name}: "
                  f"{b['name']} ({b['metric']}={b['score']}, {b['rows']} rows)")
        except Exception as e:
            print("[Eas_EV.net] auto-train failed:", e)
    threading.Thread(target=worker, daemon=True).start()


# ─── Static data mode ───────────────────────────────────────────────────────
#     The web app serves the master dataset you place at data/stations.json.
#     Replace that file with your own master database to change the stations.
#     (No background collector — the dataset is fixed until you update the file.)
@app.get("/api/data/status")
async def data_status():
    """Reports the dataset as static so the front-end watcher stays idle."""
    return {"version": "static", "refreshing": False}


@app.get("/api/net/status")
async def net_status():
    if not ML_OK:
        return {"ready": False, "reason": "Install scikit-learn, pandas, joblib (pip install -r requirements.txt)"}
    if not MODEL_PATH.exists():
        return {"ready": False, "reason": "No model trained yet — upload your Stage-3 master ML dataset in the .net tab"}
    b = joblib.load(MODEL_PATH)
    return {"ready": True, "model": b["name"], "task": b["task"], "metric": b["metric"],
            "score": b["score"], "features": b["features"][:40], "n_features": len(b["features"]),
            "comparison": b["comparison"], "trained_at": b["trained_at"], "rows": b["rows"]}


@app.post("/api/net/train")
async def net_train(file: UploadFile = File(...)):
    if not ML_OK:
        raise HTTPException(400, "scikit-learn not installed on the server")
    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception:
        raise HTTPException(400, "Could not read the CSV")
    try:
        b = _train_frame(df)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True, "best": b["name"], "task": b["task"], "metric": b["metric"],
            "score": b["score"], "rows": b["rows"], "n_features": len(b["features"]),
            "comparison": b["comparison"], "importances": b["importances"][:15]}


def _make_transform(crs_def):
    """Return a function (x_array,y_array)->(lon_array,lat_array) that reprojects to
    WGS84 lon/lat, or None if the data is already geographic / CRS unknown."""
    if not crs_def:
        return None
    try:
        from pyproj import CRS, Transformer
        crs = CRS.from_user_input(crs_def)
        if crs.is_geographic:
            return None
        tr = Transformer.from_crs(crs, 4326, always_xy=True)
        return lambda xs, ys: tr.transform(xs, ys)
    except Exception:
        return None


def _rings_from_shapefile_bytes(raw):
    import shapefile
    zf = zipfile.ZipFile(io.BytesIO(raw))
    shp = next((n for n in zf.namelist() if n.lower().endswith(".shp")), None)
    if not shp:
        raise HTTPException(400, "ZIP has no .shp inside")
    base = shp[:-4]
    def grab(ext):
        n = next((x for x in zf.namelist() if x.lower() == (base + ext).lower()), None)
        return io.BytesIO(zf.read(n)) if n else None
    prj = grab(".prj")
    tf = _make_transform(prj.read().decode("utf-8", "replace")) if prj else None
    r = shapefile.Reader(shp=grab(".shp"), dbf=grab(".dbf"), shx=grab(".shx"))
    fields = [f[0] for f in r.fields[1:]]
    recs, pts, rings = [], [], []
    for sr in r.iterShapeRecords():
        recs.append(dict(zip(fields, sr.record)))
        sh = sr.shape; p = sh.points
        if p:
            parts = list(sh.parts) + [len(p)]
            for a, b in zip(parts[:-1], parts[1:]):
                ring = np.asarray(p[a:b], dtype=float)
                if len(ring) < 3:
                    continue
                if tf is not None:
                    xs, ys = tf(ring[:, 0], ring[:, 1])
                    ring = np.column_stack([np.asarray(xs), np.asarray(ys)])
                rings.append(ring)
            if rings:
                c = rings[-1]; pts.append([float(c[:, 1].mean()), float(c[:, 0].mean())])
    return recs, pts, rings


def _rings_from_geojson(obj):
    feats = obj.get("features", [obj]) if isinstance(obj, dict) else []
    if isinstance(obj, dict) and obj.get("type") in ("Polygon", "MultiPolygon", "GeometryCollection"):
        feats = [{"type": "Feature", "geometry": obj, "properties": {}}]
    recs, pts, rings = [], [], []
    def add_geom(geom):
        gt = geom.get("type"); co = geom.get("coordinates")
        polys = []
        if gt == "Polygon": polys = [co]
        elif gt == "MultiPolygon": polys = co
        elif gt == "GeometryCollection":
            for gg in geom.get("geometries", []): add_geom(gg)
            return
        for poly in polys:
            for ring in poly:
                if ring and len(ring) >= 3:
                    rings.append(np.asarray(ring, dtype=float))
        def first_pt(cc):
            while isinstance(cc, list) and cc and isinstance(cc[0], list): cc = cc[0]
            return cc
        fp = first_pt(co) if co else None
        if fp and len(fp) >= 2: pts.append([fp[1], fp[0]])
    for f in feats:
        recs.append((f.get("properties") or {}) if isinstance(f, dict) else {})
        add_geom((f.get("geometry") or {}) if isinstance(f, dict) else {})
    return recs, pts, rings


def _rings_from_kml(text):
    import re as _re
    rings, pts = [], []
    # grab every <coordinates> block (polygons + linear rings)
    for m in _re.findall(r"<coordinates>(.*?)</coordinates>", text, _re.DOTALL | _re.IGNORECASE):
        coords = []
        for tok in m.split():
            parts = tok.split(",")
            if len(parts) >= 2:
                try: coords.append([float(parts[0]), float(parts[1])])
                except Exception: pass
        if len(coords) >= 3:
            rings.append(np.asarray(coords, dtype=float))
            c = np.asarray(coords); pts.append([float(c[:, 1].mean()), float(c[:, 0].mean())])
    if not rings:
        raise HTTPException(400, "No polygon <coordinates> found in the KML.")
    return [{}], pts, rings


def _rings_from_gpkg(raw):
    """Read a GeoPackage (SQLite): pull polygon geometries from the first feature table."""
    import sqlite3, tempfile, os, struct
    tf = tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False)
    try:
        tf.write(raw); tf.close()
        con = sqlite3.connect(tf.name); cur = con.cursor()
        try:
            rows = cur.execute("SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns").fetchall()
        except Exception:
            rows = []
        def _srs_transform(srs_id):
            if srs_id in (4326, 0, None):
                return None
            try:
                d = cur.execute("SELECT definition FROM gpkg_spatial_ref_sys WHERE srs_id=?", (srs_id,)).fetchone()
                return _make_transform(d[0] if d and d[0] else f"EPSG:{srs_id}")
            except Exception:
                return _make_transform(f"EPSG:{srs_id}")
        rings, pts, recs = [], [], []
        def parse_gpb(blob):
            # GeoPackage binary: 'GP' + ver + flags + srs(4) + envelope(optional) then WKB
            if not blob or blob[:2] != b"GP": return
            flags = blob[3]
            env_ind = (flags >> 1) & 0x07
            env_sizes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}
            off = 8 + env_sizes.get(env_ind, 0)
            wkb = blob[off:]
            _parse_wkb(wkb)
        def _parse_wkb(wkb):
            if len(wkb) < 5: return
            bo = "<" if wkb[0] == 1 else ">"
            gtype = struct.unpack(bo + "I", wkb[1:5])[0]
            base = gtype % 1000
            pos = 5
            def read_ring(pos):
                (npts,) = struct.unpack(bo + "I", wkb[pos:pos+4]); pos += 4
                coords = []
                for _ in range(npts):
                    x, y = struct.unpack(bo + "dd", wkb[pos:pos+16]); pos += 16
                    coords.append([x, y])
                return coords, pos
            def read_polygon(pos):
                (nring,) = struct.unpack(bo + "I", wkb[pos:pos+4]); pos += 4
                for _ in range(nring):
                    coords, pos = read_ring(pos)
                    if len(coords) >= 3:
                        rings.append(np.asarray(coords, dtype=float))
                        c = np.asarray(coords); pts.append([float(c[:, 1].mean()), float(c[:, 0].mean())])
                return pos
            if base == 3:
                read_polygon(pos)
            elif base == 6:
                (npoly,) = struct.unpack(bo + "I", wkb[pos:pos+4]); pos += 4
                for _ in range(npoly):
                    pos += 5  # each polygon has its own byte-order + type header
                    pos = read_polygon(pos)
        for row in (rows or []):
            tbl, gcol = row[0], row[1]; srs_id = row[2] if len(row) > 2 else None
            tf = _srs_transform(srs_id)
            try:
                data = cur.execute(f'SELECT "{gcol}" FROM "{tbl}"').fetchall()
            except Exception:
                continue
            start = len(rings)
            for (blob,) in data:
                if blob: parse_gpb(blob); recs.append({})
            if tf is not None:
                for k in range(start, len(rings)):
                    xs, ys = tf(rings[k][:, 0], rings[k][:, 1])
                    rings[k] = np.column_stack([np.asarray(xs), np.asarray(ys)])
                pts.clear()
                for k in range(start, len(rings)):
                    c = rings[k]; pts.append([float(c[:, 1].mean()), float(c[:, 0].mean())])
            if rings: break
        con.close()
        if not rings:
            raise HTTPException(400, "No polygon geometry found in the GPKG.")
        return recs or [{}], pts, rings
    finally:
        try: os.unlink(tf.name)
        except Exception: pass


def _read_uploaded_geo(raw: bytes, filename: str):
    """Shapefile ZIP / GeoJSON / KML / KMZ / GPKG / CSV -> (records, points[[lat,lon]], rings)."""
    name = (filename or "").lower()
    if name.endswith(".zip"):
        # could be a shapefile zip OR a KMZ mislabelled — detect .shp vs .kml
        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
            if any(n.lower().endswith(".kml") for n in zf.namelist()) and not any(n.lower().endswith(".shp") for n in zf.namelist()):
                kmln = next(n for n in zf.namelist() if n.lower().endswith(".kml"))
                return _rings_from_kml(zf.read(kmln).decode("utf-8", "replace"))
        except zipfile.BadZipFile:
            pass
        return _rings_from_shapefile_bytes(raw)
    if name.endswith(".kmz"):
        zf = zipfile.ZipFile(io.BytesIO(raw))
        kmln = next((n for n in zf.namelist() if n.lower().endswith(".kml")), None)
        if not kmln: raise HTTPException(400, "KMZ has no .kml inside")
        return _rings_from_kml(zf.read(kmln).decode("utf-8", "replace"))
    if name.endswith(".kml"):
        return _rings_from_kml(raw.decode("utf-8", "replace"))
    if name.endswith(".gpkg"):
        return _rings_from_gpkg(raw)
    if name.endswith(".geojson") or name.endswith(".json"):
        return _rings_from_geojson(json.loads(raw.decode("utf-8", "replace")))
    # CSV (points/grid)
    df = pd.read_csv(io.BytesIO(raw))
    pts = []
    latc = next((c for c in df.columns if c.lower() in ("lat", "latitude")), None)
    lonc = next((c for c in df.columns if c.lower() in ("lon", "lng", "longitude")), None)
    if latc and lonc: pts = df[[latc, lonc]].dropna().values.tolist()
    return df.to_dict("records"), pts, []


# ── national grid (feature-rich cells) used to score an uploaded AREA polygon ──
_GRID_CACHE = None
def _load_national_grid():
    global _GRID_CACHE
    if _GRID_CACHE is not None:
        return _GRID_CACHE
    for pth in (DATA_INPUT / "national_grid.parquet", DATA_INPUT / "national_grid.csv"):
        if pth.exists():
            try:
                g = pd.read_parquet(pth) if pth.suffix == ".parquet" else pd.read_csv(pth)
                ren = {}
                for c in list(g.columns):
                    cl = c.lower()
                    if cl in ("latitude", "y") and "lat" not in g.columns: ren[c] = "lat"
                    if cl in ("longitude", "lng", "x") and "lon" not in g.columns: ren[c] = "lon"
                if ren: g = g.rename(columns=ren)
                _GRID_CACHE = g
                return _GRID_CACHE
            except Exception:
                pass
    _GRID_CACHE = False
    return _GRID_CACHE


def _pip_mask(lon, lat, rings):
    lon = np.asarray(lon, float); lat = np.asarray(lat, float)
    inside = np.zeros(len(lon), dtype=bool)
    if not rings:
        return inside
    allr = np.vstack(rings)
    minx, miny, maxx, maxy = allr[:, 0].min(), allr[:, 1].min(), allr[:, 0].max(), allr[:, 1].max()
    box = (lon >= minx) & (lon <= maxx) & (lat >= miny) & (lat <= maxy)
    idx = np.where(box)[0]
    if len(idx) == 0:
        return inside
    lo, la = lon[idx], lat[idx]
    acc = np.zeros(len(idx), dtype=bool)
    for ring in rings:
        rx, ry = ring[:, 0], ring[:, 1]; n = len(ring); j = n - 1
        cond = np.zeros(len(idx), dtype=bool)
        for i in range(n):
            xi, yi = rx[i], ry[i]; xj, yj = rx[j], ry[j]
            denom = (yj - yi) if (yj - yi) != 0 else 1e-12
            cross = ((yi > la) != (yj > la)) & (lo < (xj - xi) * (la - yi) / denom + xi)
            cond ^= cross; j = i
        acc ^= cond
    inside[idx] = acc
    return inside


def _build_X(df, feats, med):
    sc = None
    for cand in ("scenario_category", "scenario"):
        if cand in df.columns: sc = df[cand].astype(str); break
    cols = {}
    for f in feats:
        if f.startswith("scn_") and sc is not None:
            cols[f] = (sc.values == f[4:]).astype(float)
        elif f in df.columns:
            cols[f] = pd.to_numeric(df[f], errors="coerce").values
        else:
            cols[f] = np.full(len(df), med.get(f, 0), dtype=float)
    return pd.DataFrame(cols).fillna(pd.Series(med))


@app.post("/api/net/analyze")
async def net_analyze(file: UploadFile = File(...)):
    if not ML_OK:
        raise HTTPException(400, "scikit-learn not installed on the server")
    raw = await file.read()
    recs, pts, rings = _read_uploaded_geo(raw, file.filename)
    df_up = pd.DataFrame(recs) if recs else pd.DataFrame()

    if not MODEL_PATH.exists():
        raise HTTPException(400, "No trained model on the server yet.")
    b = joblib.load(MODEL_PATH)
    model, feats, med = b["model"], b["features"], b["medians"]

    area_name = None
    for key in ("DISTRICT", "District", "district", "NAME", "Name", "name",
                "area", "AREA", "Area", "TEHSIL", "Tehsil", "STATE_UT", "STATE", "State"):
        if key in df_up.columns and len(df_up):
            v = str(df_up.iloc[0][key]).strip()
            if v and v.lower() not in ("nan", "none", ""):
                area_name = v.title() if v.isupper() else v
                break
    if not area_name:
        area_name = (file.filename or "Uploaded area").rsplit(".", 1)[0].replace("_", " ").strip() or "Uploaded area"

    num_up = _numeric_frame(df_up) if len(df_up) else pd.DataFrame()
    overlap_up = [f for f in feats if f in num_up.columns]
    grid = _load_national_grid()

    if len(overlap_up) >= max(8, int(0.15 * len(feats))):
        cells = df_up; source = "uploaded-grid"
        analyzed_pts = pts
    elif rings and grid is not False and grid is not None and len(grid):
        m = _pip_mask(grid["lon"].values, grid["lat"].values, rings)
        cells = grid.loc[m].copy(); source = "national-grid-clip"
        if not len(cells):
            raise HTTPException(400, "No national-grid cells fall inside the uploaded area "
                                     "(area may be outside India, or smaller than the grid spacing).")
        analyzed_pts = cells[["lat", "lon"]].values.tolist()
    else:
        if grid is False or grid is None:
            raise HTTPException(400, "This is a boundary polygon with no model features, and the "
                                     "national grid is not installed on the server "
                                     "(backend/data_input/national_grid.parquet). Build it once with "
                                     "make_webapp_grid.py, then restart.")
        raise HTTPException(400, "Could not read an area polygon. Upload a Shapefile ZIP / GeoJSON / KML / KMZ / GPKG polygon.")

    if len(cells) > 20000:
        cells = cells.sample(20000, random_state=42)
        analyzed_pts = cells[["lat", "lon"]].values.tolist() if source == "national-grid-clip" else analyzed_pts

    # GeoJSON outline of the uploaded area (simplified) so the frontend can scope
    # the map + report to this area instead of "All India".
    def _simplify(ring, cap=1500):
        if len(ring) <= cap:
            return ring
        step = int(np.ceil(len(ring) / cap))
        r = ring[::step]
        if not np.array_equal(r[0], r[-1]):
            r = np.vstack([r, ring[-1]])
        return r
    area_polygon = None
    if rings:
        area_polygon = {"type": "MultiPolygon",
                        "coordinates": [[_simplify(r).tolist()] for r in rings]}

    X = _build_X(cells, feats, med)
    overlap = [f for f in feats if (f in cells.columns) or (f.startswith("scn_") and ("scenario_category" in cells.columns or "scenario" in cells.columns))]

    if b["task"] == "classification" and hasattr(model, "predict_proba"):
        proba = model.predict_proba(X)
        cls = np.asarray(getattr(model, "classes_", b.get("classes") or list(range(proba.shape[1]))), dtype=float)
        expected = (proba * cls).sum(axis=1)          # expected suitability class (0..max)
        denom = cls.max() if cls.max() > 0 else 1.0
        scores = expected / denom                      # graded 0..1 (matches the 1-5 suitability scale)
    else:
        scores = np.asarray(model.predict(X), dtype=float)
        lo, hi = float(scores.min()), float(scores.max())
        scores = (scores - lo) / (hi - lo) if hi > lo else scores * 0 + 0.5

    imps = {d["feature"]: d["weight"] for d in b["importances"]}
    # standardise by the NATIONAL spread (not the clipped subset) so features that
    # are constant within the area (e.g. state totals) don't dominate every cell,
    # and cap the z-score so a single outlier feature can't swamp the ranking.
    ref = grid if (source == "national-grid-clip" and grid is not False and grid is not None) else cells
    stds = {}
    for f in feats:
        if f in getattr(ref, "columns", []):
            stds[f] = float(pd.to_numeric(ref[f], errors="coerce").std() or 1) or 1.0
        else:
            stds[f] = float(X[f].std() or 1) or 1.0
    per_row_expl = []
    Xv = X.values; Xcols = {f: k for k, f in enumerate(X.columns)}
    for i in range(min(len(X), 2000)):
        contribs = []
        for f in feats:
            z = (float(Xv[i][Xcols[f]]) - float(med.get(f, 0))) / (stds[f] or 1)
            z = max(-4.0, min(4.0, z))
            contribs.append((f, imps.get(f, 0) * z))
        contribs.sort(key=lambda t: -abs(t[1]))
        per_row_expl.append([{"feature": f, "impact": round(c, 3)} for f, c in contribs[:3]])

    s = np.asarray(scores)
    high, mid = int((s >= 0.7).sum()), int(((s >= 0.4) & (s < 0.7)).sum())
    stations_needed = max(1, round(high / 6 + mid / 20)) if (high + mid) else 0
    dc_share = min(0.85, 0.35 + float(s.mean()) * 0.5)
    n_dc = round(stations_needed * dc_share)
    reco = {"stations_needed": stations_needed,
            "mix": {"DC fast (50-120 kW)": n_dc, "AC (7-22 kW)": stations_needed - n_dc},
            "logic": f"{high} high-suitability cells (score >= 0.70) and {mid} moderate cells "
                     f"(0.40-0.69) out of {len(s)}; sized at ~1 station per 6 high / 20 moderate cells, "
                     f"DC share scaled with mean suitability {s.mean():.2f}."}

    return {
        "area_name": area_name,
        "polygon": area_polygon,
        "n_features_uploaded": len(recs),
        "cells_analyzed": int(len(X)),
        "source": source,
        "mode": "model",
        "attributes": list(df_up.columns)[:40],
        "points": analyzed_pts[:5000],
        "model": {"name": b["name"], "task": b["task"], "metric": b["metric"],
                  "score": b["score"], "trained_rows": b["rows"]},
        "feature_overlap": {"matched": len(overlap), "of": len(feats),
                            "missing_filled_with_medians": max(0, len(feats) - len(overlap))},
        "scores": [round(float(v), 3) for v in s[:5000]],
        "summary": {"mean": round(float(s.mean()), 3), "high": high, "mid": mid,
                    "low": int((s < 0.4).sum())},
        "global_importances": b["importances"][:12],
        "row_explanations": per_row_expl[:400],
        "recommendation": reco,
        "explanation": (
            f"Eas_EV.net ({b['name']}, CV {b['metric']}={b['score']}) scored "
            f"{len(X)} national-grid cell(s) "
            + ("inside your uploaded area" if source == "national-grid-clip" else "from your uploaded grid")
            + ". Global drivers: "
            + ", ".join(f"{d['feature']} ({d['weight']:.0%})" for d in b["importances"][:4]) + "."),
    }


@app.post("/api/net/predict")
async def net_predict(request: Request):
    if not ML_OK or not MODEL_PATH.exists():
        return {"ready": False}
    feats_in = await request.json()
    b = joblib.load(MODEL_PATH)
    model, feats, med = b["model"], b["features"], b["medians"]
    lower = {k.lower(): v for k, v in feats_in.items()}
    overlap = [f for f in feats if f.lower() in lower]
    X = pd.DataFrame([{f: float(lower.get(f.lower(), med.get(f, 0))) for f in feats}])
    if b["task"] == "classification" and hasattr(model, "predict_proba"):
        score = float(model.predict_proba(X)[0, -1])
    else:
        score = float(model.predict(X)[0])
    return {"ready": True, "score": round(score, 4), "model": b["name"],
            "overlap": len(overlap), "of": len(feats)}


# ── Static frontend — MUST stay the very last route ──
app.mount("/", StaticFiles(directory=ROOT, html=True), name="static")