"""State-wide demand forecasting: batched weather and one-pass prediction must match the per-place path."""
from datetime import date, timedelta

import pytest

from app.services import ml
from jalsetu_ml.weather import climatology_fallback


@pytest.fixture()
def model():
    m = ml.forecaster()
    if m is None:
        pytest.skip("demand model not trained in this checkout")
    return m


@pytest.fixture(autouse=True)
def fresh_cache():
    ml._grid_cache.clear()
    yield
    ml._grid_cache.clear()


def _weather(shift: float = 0.0):
    df = climatology_fallback(date.today() - timedelta(days=30), 37)
    return df.assign(temp_max=df.temp_max + shift, precip=df.precip + shift)


def test_forecast_groups_matches_per_place(model):
    w1, w2 = _weather(), _weather(4.0)
    places = [(w1, 52_000, 30.0), (w1, 8_000, 71.5), (w2, 130_000, 90.0)]
    batched = model.forecast_groups([(w1, [(52_000, 30.0), (8_000, 71.5)]), (w2, [(130_000, 90.0)])], start_date=date.today())
    single = [model.forecast(w, b, v, start_date=date.today()) for w, b, v in places]
    assert batched[0] + batched[1] == single


def test_failed_batch_falls_back_only_for_its_cells(model, monkeypatch):
    calls = []

    def fake_fetch(points, days, past_days, timeout):
        calls.append(len(points))
        if len(calls) == 1:
            raise TimeoutError("read timed out")
        return [_weather(1.0) for _ in points]

    monkeypatch.setattr(ml, "fetch_forecast_many", fake_fetch)
    monkeypatch.setattr(ml, "CELL_BATCH", 2)
    # Four places in four distinct ~28 km cells -> two batches of two
    items = [(18.0 + i, 74.0, 10_000, 50.0) for i in range(4)]
    rows, sources = ml.forecast_demand_many(items, days=3)

    assert calls == [2, 2]
    assert sources == {"open-meteo", "climatology-fallback"}
    assert all(len(r) == 3 for r in rows)
    cached = {k[:2]: v[2] for k, v in ml._grid_cache.items()}
    assert sorted(cached.values()) == ["climatology-fallback"] * 2 + ["open-meteo"] * 2


def test_fallback_is_retried_soon(model, monkeypatch):
    monkeypatch.setattr(ml, "fetch_forecast_many", lambda *a, **k: (_ for _ in ()).throw(TimeoutError("down")))
    ml.forecast_demand_many([(19.0, 73.0, 10_000, 50.0)], days=1)
    (stamp, _, src), = ml._grid_cache.values()
    assert src == "climatology-fallback"
    # The entry stays valid for FALLBACK_TTL_S, not the full weather TTL
    remaining = stamp + ml.WEATHER_TTL_S - ml.time.time()
    assert 0 < remaining <= ml.FALLBACK_TTL_S
