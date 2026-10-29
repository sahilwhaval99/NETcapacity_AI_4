# NetCapacity AI – Intelligent Network Forecasting & Capacity Planning

Academic Machine Learning project (B.Tech AI & DS). Demo data is synthetic.

## What is in this repo
| Folder | What it is | Runs on GitHub Pages? |
|---|---|---|
| `docs/` | Static browser-only demo (Holt-Winters forecasting + capacity planner) | Yes |
| `backend/` | FastAPI + scikit-learn ML pipeline, capacity engine, tests | No (needs Python server) |
| `frontend/` | React dashboard that talks to the backend API | Only with a hosted backend |

## Deploy the demo on GitHub Pages
1. Create a new repo and upload everything from this zip (or push it).
2. Settings → Pages → Deploy from a branch → `main` and folder `/docs` → Save.
3. Open `https://<username>.github.io/<repo>/`.

## Run the full app locally
```
pip install -r requirements.txt
cd backend && python -m pytest && uvicorn app.main:app --reload
# new terminal
cd frontend && npm install && npm run dev      # http://localhost:5173
```
API docs: http://localhost:8000/docs

## Dataset schema (hourly)
Required: `timestamp`, `bandwidth_in_mbps`. Optional: `upload_mbps`, `download_mbps`, `active_users`, `latency_ms`, `packet_loss_pct`.

## How it works
Cleaning → lag/rolling/calendar features (past values only) → chronological 80/20 split → seasonal-naive baseline vs Gradient Boosting / Random Forest → rolling 24 h recursive backtest (MAE, RMSE, R², MAPE) → recursive forecast with empirical 80% interval → capacity planner:
`peak utilization = peak / capacity × 100`, `recommended = peak / target utilization`, `gap = max(0, recommended − capacity)`.

## Known limitations
Hourly data only; no SQLite history or PDF export; React UI not yet browser-tested; forecasts are planning estimates.
