#!/usr/bin/env python3
"""
install_model_to_webapp.py
──────────────────────────
Convert the pipeline's trained  Eas_EV.net  (+ Eas_EV_explainer.pkl)  into the
exact joblib bundle schema the Eas_EV webapp's backend/server.py expects, and
write it to  <webapp>/backend/models/easev_net.joblib  — so the webapp uses YOUR
already-trained model without retraining anything.

USAGE (from the pipeline folder):
  python install_model_to_webapp.py \
      --net       output/stage2/model/Eas_EV.net \
      --explainer output/stage2/model/Eas_EV_explainer.pkl \
      --webapp    "C:/path/to/Eas_EV WEBAPP"

--explainer is optional (used for feature medians + global importances). If it's
missing, medians are taken from --data (a sample CSV, e.g. the national output)
or default to 0.
"""
import argparse, datetime
from pathlib import Path
import numpy as np, pandas as pd, joblib

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--net", required=True, help="path to Eas_EV.net")
    ap.add_argument("--explainer", default=None, help="path to Eas_EV_explainer.pkl (optional)")
    ap.add_argument("--data", default=None, help="optional CSV to compute feature medians")
    ap.add_argument("--webapp", required=True, help="path to the 'Eas_EV WEBAPP' folder (or its backend)")
    a = ap.parse_args()

    net = joblib.load(a.net)
    model    = net["model"]
    features = list(net["features"])
    classes  = [int(c) for c in net.get("classes", [])]
    name     = net.get("best_model", net.get("name", "Eas_EV.net"))
    score    = float(net.get("validation_accuracy", 0.0) or 0.0)

    # ── feature medians (needed by /analyze & /predict for imputation) ──
    medians = {f: 0.0 for f in features}
    exp = None
    if a.explainer and Path(a.explainer).exists():
        try: exp = joblib.load(a.explainer)
        except Exception: exp = None
    if exp and exp.get("lime", {}).get("medians") and exp["lime"].get("feature_names"):
        for f, m in zip(exp["lime"]["feature_names"], exp["lime"]["medians"]):
            if f in medians: medians[f] = float(m)
    elif a.data and Path(a.data).exists():
        df = pd.read_csv(a.data)
        if len(df) > 20000: df = df.sample(20000, random_state=42)
        num = df.apply(pd.to_numeric, errors="coerce")
        for f in features:
            if f in num.columns and num[f].notna().any():
                medians[f] = float(num[f].median())

    # ── global importances (list of {feature, weight}, sorted) ──
    gi = (exp.get("global_feature_importance") if exp else None) or {}
    if not gi:
        fi = getattr(model, "feature_importances_", None)
        if fi is not None:
            fi = np.asarray(fi, float).ravel()
            gi = dict(zip(features, (fi / (fi.sum() or 1)).tolist()))
    if not gi:
        gi = {f: 1.0 / len(features) for f in features}
    importances = sorted(({"feature": f, "weight": round(float(w), 4)} for f, w in gi.items()),
                         key=lambda d: -d["weight"])

    bundle = {
        "model": model,
        "name": f"{name} (Eas_EV.net)",
        "task": "classification",
        "metric": "accuracy",
        "score": round(score, 4),
        "features": features,
        "medians": medians,
        "importances": importances,
        "comparison": [{"model": name, "accuracy": round(score, 4)}],
        "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "rows": 150000,
        "label": "suitability",
        "classes": classes or None,
    }

    webapp = Path(a.webapp)
    backend = webapp if webapp.name == "backend" else webapp / "backend"
    models_dir = backend / "models"; models_dir.mkdir(parents=True, exist_ok=True)
    out = models_dir / "easev_net.joblib"
    joblib.dump(bundle, out)
    print(f"✓ installed {name} → {out}")
    print(f"  features={len(features)}  classes={classes}  score(acc)={score:.4f}")
    print("  Restart the backend (or it will pick it up on next boot). The .net tab will show this model.")

if __name__ == "__main__":
    main()
