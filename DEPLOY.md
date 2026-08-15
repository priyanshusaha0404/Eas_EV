# Eas_EV — Deployment Guide (chatbot included, keys hidden)

This deploys the whole app + the AI chatbot, with your Gemini keys kept
**on the server** so visitors can never see them.

We'll use **Render.com** (free tier, runs Python, easiest for this setup).

---

## STEP 1 — Put the project on GitHub

1. Create a free account at https://github.com
2. Create a new repository (e.g. `easev`), Public or Private both fine.
3. Upload the whole project folder (all of: index.html, css/, js/, data/, backend/, render.yaml).
   - Easiest: on the repo page → "Add file" → "Upload files" → drag the folder contents.
   - (Or use GitHub Desktop if you prefer.)

> IMPORTANT: open `js/config.js` and make sure ALL key fields are EMPTY before uploading:
> ```
> GEMINI_API_KEY: "",
> GEMINI_API_KEYS: [ "", "", "", "", "", "", "" ],
> USE_BACKEND_AGENT: true,
> ```
> The keys go on the server (Step 3), NOT in the code. `USE_BACKEND_AGENT` must be `true`.

---

## STEP 2 — Create the web service on Render

1. Sign up at https://render.com (free, can log in with GitHub).
2. Dashboard → **New +** → **Web Service**.
3. Connect your GitHub and pick the `easev` repo.
4. Render auto-reads `render.yaml`. Confirm:
   - Build command: `pip install -r backend/requirements.txt`
   - Start command: `cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT`
   - Plan: **Free**
5. Click **Create Web Service** (don't worry if the first build fails — we add keys next).

---

## STEP 3 — Add your Gemini keys (kept secret on the server)

1. In your service → **Environment** tab → **Add Environment Variable**.
2. Key: `GEMINI_API_KEYS`
   Value: all 7 keys separated by commas, no spaces:
   ```
   AIza...key1,AIza...key2,AIza...key3,AIza...key4,AIza...key5,AIza...key6,AIza...key7
   ```
3. (Optional) Add `GEMINI_MODEL` = `gemini-2.5-flash`
4. Save → Render redeploys automatically.

These values live only on Render's server. Visitors' browsers never receive them.

---

## STEP 4 — Done

- Render gives you a public URL like `https://easev.onrender.com`
- Open it — the whole app works, and the chatbot answers via the hidden server keys.
- Share that link with anyone.

---

## Notes & limits (be honest with yourself / examiners)

- **Free tier sleeps:** Render free services "sleep" after ~15 min idle; the first
  visit after that takes ~30-50 seconds to wake up. Fine for a demo; for always-on,
  upgrade to a paid plan (~$7/mo) later.
- **Rate limits still apply per key** — but the server rotates across all 7 keys,
  so effective limit is ~140 requests/min. Plenty for normal use.
- **Data files** (boundaries, stations) are served by the same server — no extra setup.
- If the chatbot says "Set GEMINI_API_KEYS env var", you missed Step 3.
- To check the server is healthy, open `https://YOUR-URL/api/health` — it shows
  how many Gemini keys it loaded.

---

## Local development (still works)

On your own computer you can either:
- keep `USE_BACKEND_AGENT: false` and put keys in `config.js` (browser-side), OR
- run the backend: `cd backend && uvicorn server:app --reload --port 8000`
  with keys in your shell: `set GEMINI_API_KEYS=key1,key2,...` (Windows) and
  `USE_BACKEND_AGENT: true` in config.js, then open http://localhost:8000
