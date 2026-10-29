"""FastAPI layer: thin handlers that delegate to ml/ and capacity/."""
import io, json
from pathlib import Path
import joblib, pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import List, Optional
from .capacity.planner import DEFAULT_TIERS, analyze
from .ml import data as D, forecast as F

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH, SETTINGS_PATH = ROOT / "models" / "model.joblib", ROOT / "data" / "settings.json"
MAX_UPLOAD = 20 * 1024 * 1024
app = FastAPI(title="NetCapacity AI API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

STATE = {"df": None, "report": None, "label": None, "bundle": None, "forecast": None}
DEFAULT_SETTINGS = {"capacity_mbps": 100.0, "target_util_pct": 80.0, "watch_pct": 60.0, "near_pct": 75.0,
                    "horizon_hours": 168, "model": "hgb", "tiers": DEFAULT_TIERS}


def ensure_data():
    if STATE["df"] is None:
        df, rep = D.validate_and_clean(D.generate_sample())
        STATE.update(df=df, report=rep, label="Demo / Synthetic Data")
    return STATE["df"]


def load_settings():
    return {**DEFAULT_SETTINGS, **(json.loads(SETTINGS_PATH.read_text()) if SETTINGS_PATH.exists() else {})}


class Settings(BaseModel):
    capacity_mbps: float = Field(gt=0)
    target_util_pct: float = Field(gt=0, le=100)
    watch_pct: float = Field(gt=0)
    near_pct: float = Field(gt=0)
    horizon_hours: int = Field(168)
    model: str = Field("hgb", pattern="^(hgb|rf)$")
    tiers: List[float] = Field(min_length=1)


class TrainReq(BaseModel):
    model: str = Field("hgb", pattern="^(hgb|rf)$")


class ForecastReq(BaseModel):
    horizon_hours: int = Field(168)


class CapacityReq(BaseModel):
    capacity_mbps: float
    target_util_pct: float = 80
    growth_pct: float = 0
    tiers: Optional[List[float]] = None
    watch_pct: float = 60
    near_pct: float = 75


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/dataset/sample")
def sample_csv():
    return Response(D.generate_sample().to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=synthetic_sample.csv"})


@app.get("/api/dataset/summary")
def summary():
    ensure_data()
    return {"label": STATE["label"], "report": STATE["report"]}


@app.post("/api/dataset/upload")
async def upload(file: UploadFile = File(...)):
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "File exceeds 20 MB limit.")
    try:  # parsed as data only, never executed
        df, rep = D.validate_and_clean(pd.read_csv(io.BytesIO(raw)))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(400, "Could not parse file as CSV.")
    STATE.update(df=df, report=rep, label=f"Uploaded: {Path(file.filename or 'data.csv').name}", bundle=None, forecast=None)
    return {"label": STATE["label"], "report": rep}


@app.post("/api/model/train")
def train(req: TrainReq):
    try:
        b = F.train(ensure_data()[F.TARGET], req.model)
    except ValueError as e:
        raise HTTPException(422, str(e))
    STATE.update(bundle=b, forecast=None)
    joblib.dump(b, MODEL_PATH)
    return {k: v for k, v in b.items() if k not in ("model", "q10", "q90")}


@app.get("/api/model/metrics")
def model_metrics():
    if STATE["bundle"] is None:
        raise HTTPException(404, "No trained model. Call POST /api/model/train first.")
    return {k: v for k, v in STATE["bundle"].items() if k not in ("model", "q10", "q90")}


@app.post("/api/forecast")
def make_forecast(req: ForecastReq):
    y = ensure_data()[F.TARGET]
    if STATE["bundle"] is None:
        STATE["bundle"] = F.train(y, load_settings()["model"])
    try:
        fc = F.forecast(STATE["bundle"], y, req.horizon_hours)
    except ValueError as e:
        raise HTTPException(422, str(e))
    STATE["forecast"] = fc
    return {"model": STATE["bundle"]["model_name"], "last_observation": str(y.index[-1]),
            "horizon_hours": req.horizon_hours, "interval": "empirical 80% from 24 h backtest residuals; widened beyond 24 h",
            "points": json.loads(fc.assign(timestamp=fc.timestamp.astype(str)).to_json(orient="records"))}


@app.post("/api/capacity/analyze")
def capacity(req: CapacityReq):
    if STATE["forecast"] is None:
        raise HTTPException(409, "Generate a forecast first (POST /api/forecast).")
    fc = STATE["forecast"]
    try:
        return analyze(fc.predicted_mbps.tolist(), req.capacity_mbps, req.target_util_pct, req.growth_pct,
                       req.tiers, req.watch_pct, req.near_pct, timestamps=fc.timestamp.tolist())
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/reports/forecast.csv")
def report_csv():
    if STATE["forecast"] is None:
        raise HTTPException(409, "Generate a forecast first.")
    return Response(STATE["forecast"].to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=forecast.csv"})


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(s: Settings):
    if not s.watch_pct < s.near_pct <= s.target_util_pct or s.horizon_hours not in (24, 168, 720):
        raise HTTPException(422, "Require watch < near <= target and horizon in 24/168/720.")
    SETTINGS_PATH.write_text(json.dumps(s.model_dump()))
    return s


@app.get("/api/dataset/series")
def series(limit: int = 5000):
    """Cleaned history (most recent `limit` rows) for the dashboard charts."""
    df = ensure_data().tail(min(max(limit, 24), 20000))
    out = df.reset_index(names="timestamp")
    out["timestamp"] = out["timestamp"].astype(str)
    out = out.astype(object).where(out.notna(), None)
    return {"label": STATE["label"], "columns": list(df.columns), "rows": out.to_dict(orient="records")}
