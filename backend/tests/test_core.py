import io, numpy as np, pandas as pd, pytest
from fastapi.testclient import TestClient
from app.main import app
from app.ml import data as D, forecast as F
from app.capacity.planner import analyze

client = TestClient(app)


@pytest.fixture(scope="module")
def clean():
    return D.validate_and_clean(D.generate_sample(days=45))[0]


def test_sample_reproducible():
    assert D.generate_sample(10).equals(D.generate_sample(10))


def test_validation_missing_column():
    with pytest.raises(ValueError):
        D.validate_and_clean(pd.DataFrame({"timestamp": ["2025-01-01"], "x": [1]}))


def test_sort_duplicates_negative_and_gaps():
    df = D.generate_sample(3).sample(frac=1, random_state=1)
    df = pd.concat([df, df.iloc[:2]])
    df.iloc[0, df.columns.get_loc("bandwidth_in_mbps")] = -5
    out, rep = D.validate_and_clean(df)
    assert out.index.is_monotonic_increasing and rep["duplicate_timestamps_dropped"] == 2
    assert any("negative" in w for w in rep["warnings"])
    assert out["bandwidth_in_mbps"].isna().sum() == 0  # single gap interpolated


def test_chrono_split_and_lag_no_leakage(clean):
    y = clean[F.TARGET]
    assert F.chrono_split(100) == 80
    X = F.build_features(y)
    assert X["lag_1"].iloc[30] == y.iloc[29]
    assert X["roll_max_24"].iloc[30] == y.iloc[6:30].max()
    assert F.feature_row(y.index[30], y.values[:30])[3:] == pytest.approx(X.iloc[30, 3:].tolist())


def test_metrics_values():
    m = F.metrics([10, 20, 30], [12, 18, 33])
    assert m["mae"] == pytest.approx(7 / 3) and m["rmse"] == pytest.approx(np.sqrt(17 / 3))
    assert F.metrics([0, 0], [1, 1])["mape"] is None


def test_train_and_forecast_shape(clean):
    y = clean[F.TARGET]
    b = F.train(y, "hgb")
    fc = F.forecast(b, y, 168)
    assert len(fc) == 168 and (fc.upper_80_mbps >= fc.predicted_mbps).all() and (fc.lower_80_mbps <= fc.predicted_mbps).all()
    assert fc.timestamp.iloc[0] == y.index[-1] + pd.Timedelta(hours=1)
    assert b["metrics"]["hgb"]["mae"] > 0 and "baseline" in b["metrics"]
    with pytest.raises(ValueError):
        F.forecast(b, y, 5)


def test_too_little_data():
    with pytest.raises(ValueError):
        F.train(D.validate_and_clean(D.generate_sample(5))[0][F.TARGET])


def test_capacity_example_from_brief():
    r = analyze([92.0, 50.0], 100, 80)
    assert r["peak_utilization_pct"] == pytest.approx(92) and r["recommended_capacity_mbps"] == pytest.approx(115)
    assert r["capacity_gap_mbps"] == pytest.approx(15) and r["recommended_tier_mbps"] == 150
    assert r["status"] == "Upgrade recommended" and r["steps_to_breach"] == 0


def test_capacity_growth_and_no_gap():
    r = analyze([40.0], 100, 80, growth_pct=10)
    assert r["peak_demand_mbps"] == pytest.approx(44) and r["capacity_gap_mbps"] == 0 and r["status"] == "Healthy"


@pytest.mark.parametrize("args", [([], 100), ([1], 0), ([1], -5), ([1], 100, 0), ([1], 100, 120), ([-1], 100)])
def test_capacity_invalid(args):
    with pytest.raises(ValueError):
        analyze(*args)
    with pytest.raises(ValueError):
        analyze([1], 100, growth_pct=-1)


def test_api_flow():
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.post("/api/capacity/analyze", json={"capacity_mbps": 100}).status_code in (200, 409)
    assert client.post("/api/model/train", json={"model": "hgb"}).status_code == 200
    r = client.post("/api/forecast", json={"horizon_hours": 24})
    assert r.status_code == 200 and len(r.json()["points"]) == 24
    assert client.post("/api/forecast", json={"horizon_hours": 7}).status_code == 422
    c = client.post("/api/capacity/analyze", json={"capacity_mbps": 100, "target_util_pct": 80})
    assert c.status_code == 200 and "status" in c.json()
    assert client.get("/api/reports/forecast.csv").text.startswith("timestamp,predicted_mbps")


def test_upload_errors_and_success():
    assert client.post("/api/dataset/upload", files={"file": ("a.csv", b"a,b\n1,2\n")}).status_code == 422
    csv = D.generate_sample(20).to_csv(index=False).encode()
    r = client.post("/api/dataset/upload", files={"file": ("ok.csv", io.BytesIO(csv))})
    assert r.status_code == 200 and r.json()["report"]["rows_out"] == 480


def test_series_endpoint():
    r = client.get("/api/dataset/series?limit=48").json()
    assert len(r["rows"]) == 48 and "bandwidth_in_mbps" in r["columns"] and r["rows"][0]["timestamp"]
