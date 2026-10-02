from app.services.allocation import AllocationInput, jain_index, optimise


def items():
    return [
        AllocationInput("a", "A", demand=60_000, population=8_000, priority=90, vulnerability=90, current_allocation=30_000),
        AllocationInput("b", "B", demand=40_000, population=6_000, priority=50, vulnerability=40, current_allocation=40_000),
        AllocationInput("c", "C", demand=50_000, population=7_000, priority=70, vulnerability=70, current_allocation=40_000),
    ]


def test_never_exceeds_supply_or_demand():
    res = optimise(items(), 100_000, survival_lpcd=3)
    assert sum(res.allocations.values()) <= 100_000
    for it in items():
        assert res.allocations[it.community_id] <= it.demand


def test_uses_all_supply_when_short():
    res = optimise(items(), 100_000, survival_lpcd=3)
    assert sum(res.allocations.values()) >= 100_000 - 100 * len(items())


def test_survival_floor_respected():
    res = optimise(items(), 100_000, survival_lpcd=3)
    for it in items():
        assert res.allocations[it.community_id] >= min(it.demand, it.population * 3) - 100


def test_coverage_proportional_to_priority_when_unconstrained():
    res = optimise(items(), 100_000, survival_lpcd=0)
    cov = {i.community_id: res.allocations[i.community_id] / i.demand for i in items()}
    assert cov["a"] > cov["c"] > cov["b"]
    assert abs(cov["a"] / cov["b"] - 90 / 50) < 0.05


def test_full_supply_serves_everyone():
    res = optimise(items(), 1_000_000, survival_lpcd=3)
    assert all(res.allocations[i.community_id] == i.demand for i in items())


def test_floors_scaled_when_supply_tiny():
    res = optimise(items(), 10_000, survival_lpcd=3)
    assert res.floors_scaled
    assert sum(res.allocations.values()) <= 10_000
    assert all(v > 0 for v in res.allocations.values())


def test_protected_floor_held_during_disruption():
    its = items()
    its[0].protected_floor = 50_000
    res = optimise(its, 90_000, survival_lpcd=3)
    assert res.allocations["a"] >= 50_000 - 100


def test_fairness_improves_over_status_quo():
    res = optimise(items(), 110_000, survival_lpcd=3)
    assert res.metrics_after["needWeightedEquity"] > res.metrics_before["needWeightedEquity"]


def test_jain_bounds():
    assert jain_index([1, 1, 1]) == 1.0
    assert abs(jain_index([1, 0, 0]) - 1 / 3) < 1e-9


def test_min_coverage_guarantee():
    res = optimise(items(), 100_000, survival_lpcd=0, min_coverage=0.5)
    for it in items():
        assert res.allocations[it.community_id] >= 0.5 * it.demand - 100
    # infeasible guarantee falls back gracefully
    res2 = optimise(items(), 40_000, survival_lpcd=0, min_coverage=0.5)
    assert sum(res2.allocations.values()) <= 40_000 and res2.notes
