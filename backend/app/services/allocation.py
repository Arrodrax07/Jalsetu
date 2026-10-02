"""Fair water allocation optimizer.

Two-stage, closed-form convex optimisation:

1. **Floors** - every community first receives max(population x L_survival, min_coverage x demand)
   (Sphere/WHO drinking + cooking minimum, plus an optional policy coverage guarantee).  If supply cannot cover all floors, floors are
   scaled down proportionally so nobody is left at zero.

2. **Weighted proportional fairness** - the remaining supply maximises

        sum_i  p_i * d_i * log(x_i)     s.t.  sum_i x_i = S,  floor_i <= x_i <= d_i

   where p_i is the explainable priority score and d_i the (forecast) demand.  The KKT
   conditions give x_i = clip(p_i * d_i / nu, floor_i, d_i): every community's coverage
   is proportional to its priority until it is fully served.  nu is found by bisection
   (water-filling), so the result is exact and deterministic.

During a supply disruption, communities above the protection threshold are "held
harmless": their floor is raised to their previous allocation when supply allows.

Fairness is reported as Jain's index of allocation per unit of priority-weighted need
(1.0 = allocation exactly proportional to need), alongside the plain coverage Jain index,
worst-off coverage and vulnerable-community coverage.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AllocationInput:
    community_id: str
    name: str
    demand: float
    population: int
    priority: float           # 0-100
    vulnerability: float      # 0-100
    current_allocation: float
    protected_floor: float = 0.0  # used during disruptions


@dataclass
class AllocationResult:
    allocations: dict[str, int]
    floors: dict[str, int]
    supply: int
    total_demand: int
    metrics_before: dict[str, float]
    metrics_after: dict[str, float]
    floors_scaled: bool = False
    notes: list[str] = field(default_factory=list)


def jain_index(values: list[float]) -> float:
    vals = [max(0.0, v) for v in values]
    s, sq = sum(vals), sum(v * v for v in vals)
    if sq == 0:
        return 0.0
    return (s * s) / (len(vals) * sq)


def fairness_metrics(items: list[AllocationInput], alloc: dict[str, float], vuln_threshold: float = 75) -> dict[str, float]:
    cov = {i.community_id: min(1.0, alloc.get(i.community_id, 0) / max(i.demand, 1)) for i in items}
    need_norm = [alloc.get(i.community_id, 0) / max(i.priority * i.demand, 1e-9) for i in items]
    vulnerable = [i for i in items if i.vulnerability >= vuln_threshold]
    total_d = sum(i.demand for i in items) or 1
    return {
        "needWeightedEquity": round(100 * jain_index(need_norm), 1),
        "coverageEquality": round(100 * jain_index(list(cov.values())), 1),
        "minCoveragePct": round(100 * min(cov.values()), 1) if cov else 0.0,
        "avgCoveragePct": round(100 * sum(min(alloc.get(i.community_id, 0), i.demand) for i in items) / total_d, 1),
        "vulnerableCoveragePct": round(100 * sum(min(alloc.get(i.community_id, 0), i.demand) for i in vulnerable) / max(sum(i.demand for i in vulnerable), 1), 1) if vulnerable else 0.0,
    }


def _water_fill(items: list[AllocationInput], lower: dict[str, float], budget: float) -> dict[str, float]:
    """x_i = clip(p_i d_i / nu, lower_i, d_i) with sum x_i = budget."""
    def total(nu: float) -> float:
        return sum(min(i.demand, max(lower[i.community_id], max(i.priority, 1e-6) * i.demand / nu)) for i in items)

    if total(1e-12) <= budget:  # enough water for everyone
        return {i.community_id: i.demand for i in items}
    lo, hi = 1e-12, 1e12
    for _ in range(200):
        mid = (lo * hi) ** 0.5
        if total(mid) > budget:
            lo = mid
        else:
            hi = mid
    nu = hi
    return {i.community_id: min(i.demand, max(lower[i.community_id], max(i.priority, 1e-6) * i.demand / nu)) for i in items}


def _round_to_budget(raw: dict[str, float], budget: int, step: int = 100) -> dict[str, int]:
    """Largest-remainder rounding to ``step`` litres without exceeding the budget."""
    out = {k: int(v // step) * step for k, v in raw.items()}
    target = min(budget, int(round(sum(raw.values()))))
    spare = (target - sum(out.values())) // step
    for k in sorted(raw, key=lambda k: -(raw[k] - out[k])):
        if spare <= 0:
            break
        if raw[k] - out[k] > 0:
            out[k] += step
            spare -= 1
    return out


def optimise(items: list[AllocationInput], supply: float, survival_lpcd: float, vuln_threshold: float = 75,
             min_coverage: float = 0.0) -> AllocationResult:
    supply = max(0.0, float(supply))
    notes: list[str] = []

    # Floors are layered in order of moral priority; each layer is kept only if supply can honour it:
    #   1. survival (drinking + cooking)   2. protected vulnerable communities (disruptions)
    #   3. policy minimum-coverage guarantee for everyone.
    survival = {i.community_id: min(i.demand, i.population * survival_lpcd) for i in items}
    protected = {i.community_id: max(survival[i.community_id], min(i.demand, i.protected_floor)) for i in items}
    with_min = {i.community_id: max(protected[i.community_id], min(i.demand, min_coverage * i.demand)) for i in items}

    floors_scaled = False
    if sum(with_min.values()) <= supply:
        floors = with_min
    elif sum(protected.values()) <= supply:
        floors = protected
        if min_coverage > 0:
            notes.append(f"Supply too low to guarantee {min_coverage:.0%} coverage everywhere; vulnerable communities prioritised.")
    elif sum(survival.values()) <= supply:
        floors = survival
        if any(i.protected_floor for i in items):
            notes.append("Supply too low to hold protected communities harmless; survival floors applied.")
    else:
        scale = supply / max(sum(survival.values()), 1)
        floors = {k: v * scale for k, v in survival.items()}
        floors_scaled = True
        notes.append(f"Supply covers only {scale:.0%} of survival floors; floors scaled proportionally.")

    raw = _water_fill(items, floors, supply) if not floors_scaled else floors
    alloc = _round_to_budget(raw, int(supply))
    total_d = sum(i.demand for i in items)
    if supply >= total_d:
        notes.append("Supply meets total demand; every community fully served.")

    return AllocationResult(
        allocations=alloc,
        floors={k: int(round(v)) for k, v in floors.items()},
        supply=int(supply),
        total_demand=int(total_d),
        metrics_before=fairness_metrics(items, {i.community_id: i.current_allocation for i in items}, vuln_threshold),
        metrics_after=fairness_metrics(items, alloc, vuln_threshold),
        floors_scaled=floors_scaled,
        notes=notes,
    )
