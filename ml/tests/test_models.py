"""Model quality gates. Run after training: ``pytest ml/tests``.

The golden set below is hand-written, free-form phrasing that does NOT come from the
corpus generator, so it is a sanity check on real-world wording.
"""
import pandas as pd
import pytest

from jalsetu_ml import config
from jalsetu_ml.complaints import ComplaintTriage, find_duplicates
from jalsetu_ml.demand import DemandForecaster
from jalsetu_ml.weather import climatology_fallback

GOLDEN_CATEGORY = [
    ("Our chawl hasn't had a single drop from the municipal line since Monday", "No Water"),
    ("bhai 2 din se nal sukha pada hai kuch karo", "No Water"),
    ("आज सुबह से नल में पानी नहीं है", "No Water"),
    ("We were told the tanker would arrive at 8am, it's now 2pm and still nothing", "Late Tanker"),
    ("tanker wala phir se late hai, 4 ghante ho gaye", "Late Tanker"),
    ("टँकर अजून आला नाही, सकाळपासून वाट पाहतोय", "Late Tanker"),
    ("The tanker emptied after just ten houses, rest of us got nothing", "Insufficient Quantity"),
    ("sirf 2 balti pani mila poore ghar ke liye", "Insufficient Quantity"),
    ("Water coming out brownish and smells terrible, kids drinking it", "Poor Water Quality"),
    ("pani mein se badbu aa rahi hai aur rang peela hai", "Poor Water Quality"),
    ("पाण्याला घाण वास येतो आणि गढूळ आहे", "Poor Water Quality"),
    ("Tanker went to the building opposite and skipped our society entirely", "Missed Delivery"),
    ("hamara naam list mein tha phir bhi tanker nahi aaya hamari gali", "Missed Delivery"),
    ("Can you tell me the timing of the tanker next week?", "Billing or Other"),
    ("There's a big pipe leak near the bus stop wasting water", "Billing or Other"),
]

GOLDEN_CRITICAL = [
    "No water for 4 days and children in the basti are getting sick with diarrhoea",
    "dispensary mein bhi pani nahi hai, yeh emergency hai",
    "पानी गंदा है और लोगों को उल्टी-दस्त हो रहे हैं",
]


@pytest.fixture(scope="module")
def triage():
    if not config.COMPLAINT_MODEL_PATH.exists():
        pytest.skip("complaint model not trained")
    return ComplaintTriage()


def test_golden_category_accuracy(triage):
    hits = [triage.predict(t).category == y for t, y in GOLDEN_CATEGORY]
    acc = sum(hits) / len(hits)
    misses = [(t, triage.predict(t).category, y) for (t, y), h in zip(GOLDEN_CATEGORY, hits) if not h]
    assert acc >= 0.75, f"golden accuracy {acc:.2f}; misses: {misses}"


def test_critical_cues_escalate(triage):
    sev = [triage.predict(t).severity for t in GOLDEN_CRITICAL]
    assert sum(s in ("Critical", "High") for s in sev) == len(sev), sev
    assert sum(s == "Critical" for s in sev) >= 2, sev


def test_probabilities_are_distribution(triage):
    r = triage.predict("pani nahi aa raha")
    assert abs(sum(r.category_probabilities.values()) - 1) < 1e-3
    assert 0 < r.category_confidence <= 1


def test_find_duplicates():
    cands = [("C1", "No water in Shivaji Nagar lane 4 since 3 days"), ("C2", "Tanker driver asked for bribe")]
    hits = find_duplicates("Shivaji nagar lane 4 no water since three days", cands, threshold=0.4)
    assert hits and hits[0][0] == "C1"
    assert all(h[0] != "C2" for h in hits)


@pytest.fixture(scope="module")
def forecaster():
    if not config.DEMAND_MODEL_PATH.exists():
        pytest.skip("demand model not trained")
    return DemandForecaster()


def test_demand_heat_and_monsoon_direction(forecaster):
    may = climatology_fallback(pd.Timestamp("2026-05-01").date(), 40)
    jul = climatology_fallback(pd.Timestamp("2026-07-01").date(), 40)
    f_may = forecaster.forecast(may, 50_000, 80)[-1]["litres_p50"]
    f_jul = forecaster.forecast(jul, 50_000, 80)[-1]["litres_p50"]
    assert f_may > f_jul, (f_may, f_jul)


def test_forecast_interval_ordering(forecaster):
    w = climatology_fallback(pd.Timestamp("2026-04-01").date(), 37)
    for row in forecaster.forecast(w, 40_000, 60):
        assert row["litres_p10"] <= row["litres_p50"] <= row["litres_p90"]


def test_beats_static_baseline(forecaster):
    m = forecaster.metrics
    assert m["model"]["mape_pct"] < m["baseline_static_demand"]["mape_pct"]
    assert m["model"]["mape_pct"] < m["baseline_monthly_seasonal"]["mape_pct"]


def test_semantic_duplicates_cross_script(triage):
    cands = [("C1", "Water is dirty and smells bad"), ("C2", "Tanker came late today")]
    hits = find_duplicates("पानी गंदा आ रहा है और बदबू आ रही है", cands, threshold=0.55, embedder=triage.embedder)
    assert [h[0] for h in hits] == ["C1"]


def test_semantic_does_not_merge_distinct_same_category(triage):
    cands = [("C1", "No water in building 12 near the school since morning")]
    assert find_duplicates("No water in lane 4 for 3 days", cands, threshold=0.55, embedder=triage.embedder) == []
