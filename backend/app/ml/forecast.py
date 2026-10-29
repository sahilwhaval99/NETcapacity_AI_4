"""Lag-feature forecasting: baseline vs Random Forest / Gradient Boosting, recursive multi-step, empirical intervals."""
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor

TARGET = "bandwidth_in_mbps"
LAGS = [1, 2, 3, 6, 12, 24]
FEATURES = ["hour", "dow", "weekend"] + [f"lag_{k}" for k in LAGS] + ["roll_mean_6", "roll_mean_24", "roll_max_24"]
MIN_ROWS = 24 * 14
BLOCK = 24


def build_features(y: pd.Series) -> pd.DataFrame:
    """Every feature uses only values strictly before time t (no leakage)."""
    X = pd.DataFrame(index=y.index)
    X["hour"], X["dow"] = y.index.hour, y.index.dayofweek
    X["weekend"] = (X["dow"] >= 5).astype(int)
    for k in LAGS:
        X[f"lag_{k}"] = y.shift(k)
    s = y.shift(1)
    X["roll_mean_6"], X["roll_mean_24"], X["roll_max_24"] = s.rolling(6).mean(), s.rolling(24).mean(), s.rolling(24).max()
    return X[FEATURES]


def feature_row(ts, hist) -> list:
    h = np.asarray(hist, dtype=float)
    return [ts.hour, ts.dayofweek, int(ts.dayofweek >= 5)] + [h[-k] for k in LAGS] + [h[-6:].mean(), h[-24:].mean(), h[-24:].max()]


def chrono_split(n: int, frac: float = 0.8) -> int:
    return int(n * frac)


def make_model(name: str):
    if name == "rf":
        return RandomForestRegressor(n_estimators=60, min_samples_leaf=3, random_state=42, n_jobs=1)
    if name == "hgb":
        return HistGradientBoostingRegressor(max_iter=200, learning_rate=0.08, random_state=42)
    raise ValueError("Unknown model. Use 'rf' or 'hgb'.")


def fit(model, y: pd.Series):
    d = build_features(y).assign(_y=y).dropna()
    if len(d) < 24 * 7:
        raise ValueError("Too few complete rows to train.")
    model.fit(d[FEATURES].values, d["_y"].values)
    return model


def recursive_forecast(model, history, last_ts, steps: int, freq="h"):
    hist, out = list(history[-48:]), []
    idx = pd.date_range(last_ts, periods=steps + 1, freq=freq)[1:]
    for ts in idx:
        p = float(max(model.predict(np.array([feature_row(ts, hist)]))[0], 0.0))
        out.append(p); hist.append(p)
    return idx, np.array(out)


def seasonal_naive(history, steps: int, period: int = 24) -> np.ndarray:
    last = np.asarray(history[-period:], dtype=float)
    return np.array([last[i % period] for i in range(steps)])


def metrics(actual, pred) -> dict:
    a, p = np.asarray(actual, float), np.asarray(pred, float)
    err = a - p
    ss_tot = float(((a - a.mean()) ** 2).sum())
    mask = np.abs(a) > 1.0  # MAPE safeguard for near-zero actuals
    return {"mae": float(np.abs(err).mean()), "rmse": float(np.sqrt((err**2).mean())),
            "r2": float(1 - (err**2).sum() / ss_tot) if ss_tot > 0 else None,
            "mape": float(np.abs(err[mask] / a[mask]).mean() * 100) if mask.any() else None}


def backtest(model, y: pd.Series, cut: int):
    """Rolling-origin test: from each day boundary in the test period, forecast 24 h recursively from ACTUAL history."""
    vals, A, P, B, T = y.values, [], [], [], []
    for s in range(cut, len(y) - BLOCK + 1, BLOCK):
        if np.isnan(vals[s - 24:s + BLOCK]).any():
            continue
        _, p = recursive_forecast(model, vals[:s], y.index[s - 1], BLOCK)
        A.append(vals[s:s + BLOCK]); P.append(p); B.append(seasonal_naive(vals[:s], BLOCK)); T.append(y.index[s:s + BLOCK])
    if not A:
        raise ValueError("Test period too short for backtesting.")
    return np.array(A), np.array(P), np.array(B), T


def train(y: pd.Series, model_name: str = "hgb") -> dict:
    y = y.astype(float)
    if len(y) < MIN_ROWS:
        raise ValueError(f"Need at least {MIN_ROWS} hourly rows (14 days); got {len(y)}.")
    if pd.infer_freq(y.index) not in ("h", "H"):
        raise ValueError("This version supports hourly data only.")
    cut = chrono_split(len(y))
    res = {}
    for name in ("hgb", "rf"):
        m = fit(make_model(name), y.iloc[:cut])           # train period only
        A, P, B, T = backtest(m, y, cut)
        res[name] = {"metrics": metrics(A.ravel(), P.ravel()), "A": A, "P": P}
        if name == "hgb":
            res["baseline"] = {"metrics": metrics(A.ravel(), B.ravel())}
            res["_T"] = T
    sel = res[model_name]
    resid = sel["A"] - sel["P"]
    final = fit(make_model(model_name), y)                 # refit on all data for forecasting
    return {"model": final, "model_name": model_name, "trained_rows": len(y),
            "train_end": str(y.index[cut - 1]), "test_start": str(y.index[cut]), "test_end": str(y.index[-1]),
            "metrics": {k: res[k]["metrics"] for k in ("baseline", "hgb", "rf")},
            "q10": np.quantile(resid, 0.10, axis=0), "q90": np.quantile(resid, 0.90, axis=0),
            "backtest": {"timestamps": [str(t) for t in np.concatenate(res["_T"])],
                         "actual": sel["A"].ravel().tolist(), "predicted": sel["P"].ravel().tolist()}}


def forecast(bundle: dict, y: pd.Series, horizon_hours: int) -> pd.DataFrame:
    if horizon_hours not in (24, 168, 720):
        raise ValueError("Horizon must be 24, 168 or 720 hours.")
    if y.iloc[-24:].isna().any():
        raise ValueError("Last 24 observations contain gaps; cannot forecast reliably.")
    idx, p = recursive_forecast(bundle["model"], y.values, y.index[-1], horizon_hours)
    i = np.arange(horizon_hours)
    scale = np.where(i < 24, 1.0, np.sqrt((i + 1) / 24))   # widen beyond the 24 h that was validated
    q10 = np.minimum(bundle["q10"][np.minimum(i, 23)], 0) * scale   # interval always brackets the point forecast
    q90 = np.maximum(bundle["q90"][np.minimum(i, 23)], 0) * scale
    return pd.DataFrame({"timestamp": idx, "predicted_mbps": p,
                         "lower_80_mbps": np.maximum(p + q10, 0), "upper_80_mbps": p + q90})
