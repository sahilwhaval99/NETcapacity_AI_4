"""Synthetic data generation, CSV validation and cleaning."""
import numpy as np, pandas as pd

REQUIRED = ["timestamp", "bandwidth_in_mbps"]
OPTIONAL = ["upload_mbps", "download_mbps", "active_users", "latency_ms", "packet_loss_pct"]


def generate_sample(days: int = 120, seed: int = 42) -> pd.DataFrame:
    """SYNTHETIC hourly campus-style traffic (not real measurements). Reproducible via seed."""
    rng = np.random.default_rng(seed)
    ts = pd.date_range("2025-01-01", periods=days * 24, freq="h")
    h, dow, n = ts.hour.values, ts.dayofweek.values, len(ts)
    daily = 0.3 + 0.7 * np.exp(-((h - 14) ** 2) / (2 * 4.0**2))
    weekend = np.where(dow >= 5, 0.55, 1.0)
    growth = 1 + 0.004 * np.arange(n) / 24
    spikes = (rng.random(n) < 0.006) * rng.uniform(8, 20, n)
    bw = np.clip(55 * daily * weekend * growth + rng.normal(0, 2.0, n) + spikes, 1, None)
    return pd.DataFrame({
        "timestamp": ts,
        "bandwidth_in_mbps": bw.round(2),
        "download_mbps": (bw * 0.78).round(2),
        "upload_mbps": (bw * 0.22).round(2),
        "active_users": np.clip(bw * 4 + rng.normal(0, 15, n), 0, None).round(0),
        "latency_ms": (12 + 40 * (bw / 120) ** 3 + rng.normal(0, 1.5, n)).clip(1).round(2),
        "packet_loss_pct": np.clip(0.02 + 0.5 * (bw / 120) ** 4 + rng.normal(0, 0.02, n), 0, None).round(3),
    })


def validate_and_clean(df: pd.DataFrame, max_gap: int = 3):
    """Returns (clean_df on a regular grid indexed by timestamp, report dict). Raises ValueError if unusable."""
    missing_cols = [c for c in REQUIRED if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Missing required column(s): {missing_cols}. Expected: {REQUIRED} (+ optional {OPTIONAL}).")
    df = df.copy()
    rep = {"rows_in": int(len(df)), "warnings": []}
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    rep["invalid_timestamps_dropped"] = int(df["timestamp"].isna().sum())
    df = df.dropna(subset=["timestamp"])
    cols = [c for c in REQUIRED[1:] + OPTIONAL if c in df.columns]
    for c in cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
        neg = int((df[c] < 0).sum())
        if neg:
            df.loc[df[c] < 0, c] = np.nan
            rep["warnings"].append(f"{neg} negative value(s) in {c} treated as missing.")
    rep["duplicate_timestamps_dropped"] = int(df["timestamp"].duplicated().sum())
    df = df.drop_duplicates("timestamp", keep="first").sort_values("timestamp").set_index("timestamp")[cols]
    if len(df) < 2:
        raise ValueError("Not enough valid rows after cleaning.")
    diffs = df.index.to_series().diff().dropna()
    step = diffs.median()
    rep["frequency"] = str(step)
    rep["irregular_intervals"] = int((diffs != step).sum())
    if rep["irregular_intervals"]:
        rep["warnings"].append(f"{rep['irregular_intervals']} irregular interval(s); series reindexed to a regular {step} grid.")
    df = df.reindex(pd.date_range(df.index[0], df.index[-1], freq=step))
    rep["missing_before_fill"] = {c: int(df[c].isna().sum()) for c in cols}
    df = df.interpolate(method="time", limit=max_gap, limit_area="inside")
    rep["missing_after_fill"] = {c: int(df[c].isna().sum()) for c in cols}
    if rep["missing_after_fill"]["bandwidth_in_mbps"]:
        rep["warnings"].append(f"Gaps longer than {max_gap} steps left missing; those rows are excluded from training.")
    rep.update(rows_out=int(len(df)), start=str(df.index[0]), end=str(df.index[-1]))
    return df, rep
