from app.services.routing import Matrix, Point, best_order, evaluate, optimise_route


def _line_matrix(xs):
    n = len(xs)
    d = [[abs(xs[i] - xs[j]) * 1000 for j in range(n)] for i in range(n)]
    return Matrix([[v / 10 for v in row] for row in d], d, "test")


def test_best_order_on_a_line_visits_in_sweep():
    # depot at 0, stops at 3, 1, 2 (km). Optimal tour sweeps 1 -> 2 -> 3 and back.
    m = _line_matrix([0, 3, 1, 2])
    order = best_order(3, m, [0, 1, 1, 1])
    assert order == [2, 3, 1]


def test_urgency_pulls_critical_stop_forward():
    # depot at 0; stops at +1, +2 and -1 (critical). Both sweep directions cost the same
    # distance, so the urgency term must decide: serve the critical stop first.
    m = _line_matrix([0, 1, 2, -1])
    assert best_order(3, m, [0, 1, 1, 50])[0] == 3
    assert best_order(3, m, [0, 50, 1, 1])[0] == 1


def test_optimised_never_worse_than_baseline():
    m = _line_matrix([0, 3, 1, 2, 5, 4])
    w = [0, 1, 1, 1, 1, 1]
    base = evaluate([1, 2, 3, 4, 5], m, w)[0]
    best = evaluate(best_order(5, m, w), m, w)[0]
    assert best <= base


def test_fallback_when_osrm_unreachable():
    depot = Point("d", "Depot", 19.035, 72.898)
    stops = [Point("a", "A", 19.0607, 72.9264, 0.9), Point("b", "B", 19.0434, 72.8567, 0.5)]
    plan = optimise_route(depot, stops, fallback_speed_kmh=22, circuity=1.35)
    assert plan.source == "haversine-fallback"
    assert plan.distance_km > 0 and plan.duration_min > 0
    assert plan.distance_km <= plan.baseline_distance_km + 1e-6
