EasEV — models folder
=====================

ACTIVE MODEL (the webapp loads and uses this):
  easev_net.joblib
    - Unified Eas_EV.net converted into the schema backend/server.py expects.
    - LightGBM, validation accuracy 0.9979, 110 features, suitability classes 0-5.
    - server.py loads it at:  MODEL_PATH = backend/models/easev_net.joblib
    - Used by endpoints:       /api/net/status, /api/net/analyze, /api/net/predict
    - Already installed. Nothing else to do - just start the backend.

The 12 per-scenario models and the SHAP/LIME explainer are NOT loaded by the
webapp (it runs one unified model) and are kept OUT of this package to keep it
lean/deployable. You already have them in your pipeline output folder:
  output/stage2/model/{Eas_EV.net, Eas_EV_explainer.pkl, <scenario>_best.joblib}

To refresh the active model later from the pipeline output:
  python install_model_to_webapp.py \
      --net       output/stage2/model/Eas_EV.net \
      --explainer output/stage2/model/Eas_EV_explainer.pkl \
      --webapp    "path/to/Eas_EV WEBAPP"
