"""Transparent capacity-planning formulas (units: Mbps)."""
DEFAULT_TIERS = [50, 100, 150, 200, 300, 500, 1000]


def analyze(forecast_mbps, capacity_mbps, target_util_pct=80.0, growth_pct=0.0, tiers=None,
            watch_pct=60.0, near_pct=75.0, timestamps=None) -> dict:
    """growth_pct is EXTRA demand not already in history (e.g. planned new users); applied once to the forecast."""
    if forecast_mbps is None or len(forecast_mbps) == 0:
        raise ValueError("Forecast is empty; generate a forecast first.")
    if capacity_mbps is None or capacity_mbps <= 0:
        raise ValueError("Capacity must be greater than zero.")
    if not 0 < target_util_pct <= 100:
        raise ValueError("Target utilization must be in (0, 100].")
    if growth_pct < 0 or any(v < 0 for v in forecast_mbps):
        raise ValueError("Growth and forecast values must not be negative.")
    if not 0 < watch_pct < near_pct <= target_util_pct:
        raise ValueError("Require 0 < watch < near <= target.")
    f = [v * (1 + growth_pct / 100) for v in forecast_mbps]
    avg, peak = sum(f) / len(f), max(f)
    util = peak / capacity_mbps * 100
    rec = peak / (target_util_pct / 100)
    status = ("Upgrade recommended" if util > target_util_pct else "Near capacity" if util > near_pct
              else "Watch" if util > watch_pct else "Healthy")
    tier = next((t for t in sorted(tiers or DEFAULT_TIERS) if t >= rec), None)
    limit = capacity_mbps * target_util_pct / 100
    hit = next((i for i, v in enumerate(f) if v > limit), None)
    return {"avg_demand_mbps": avg, "peak_demand_mbps": peak, "peak_utilization_pct": util,
            "headroom_mbps": capacity_mbps - peak, "recommended_capacity_mbps": rec,
            "capacity_gap_mbps": max(0.0, rec - capacity_mbps), "recommended_tier_mbps": tier, "status": status,
            "first_threshold_breach": str(timestamps[hit]) if hit is not None and timestamps is not None else None,
            "steps_to_breach": hit,
            "note": "Planning estimate from a statistical forecast, not a guaranteed engineering decision."
                    + ("" if tier else " No configured tier is large enough.")}
