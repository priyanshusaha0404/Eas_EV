STATION DATA — how to use your own master database
==================================================

The map, trip planner and dashboards read the file:

    data/stations.json

To use YOUR OWN master database, replace stations.json with your data in the
SAME record shape the app expects. Each station is one JSON object; the app
uses these fields (extra fields are ignored, missing ones are simply blank):

    id, name, operator, network, source,
    lat, lon,                       (numbers — required)
    type            "AC" | "DC" | "AC_DC"
    category        "AC" | "DC" | "AC_DC" | "ULTRA FAST" | "BATTERY SWAP"
    fast, ultra     true/false
    powerKW, ports, acCount, dcCount,
    status, operational, access, open247,
    pricing, phone, email, website,
    address, area, city, district, state, pincode,
    rating, ratingCount, verified, confidence, quality, updated

The file must be a JSON ARRAY:  [ {station1}, {station2}, ... ]

If your master database is a CSV, convert it to this JSON array first
(any CSV→JSON tool, or ask for a tiny converter script).

Eas_EV.net (.net tab):
    Separately, in the .net tab you upload your Stage-3 master ML CSV and the
    server trains the model on it — exactly as before. That is unrelated to
    stations.json above.
