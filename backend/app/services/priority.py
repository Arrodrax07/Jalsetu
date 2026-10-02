"""Transparent, explainable priority scoring (0-100).

    P = sum_k w_k * S_k / sum_k w_k

S_demand    100 * demand / max demand across active communities
S_vuln      community vulnerability score (0-100, from census/socio-economic survey)
S_unmet     100 * (demand - allocated) / demand  (a request's days-without-water can raise it)
S_gap       100 - delivered coverage over the last 7 days (falls back to previous allocation)
S_pop       100 * population / max population across active communities
"""
from __future__ import annotations

from dataclasses import dataclass, field

FACTOR_LABELS = {
    "demand": "Demand severity",
    "vulnerability": "Socio-economic vulnerability",
    "unmetNeed": "Unmet need",
    "previousCoverage": "Historical coverage gap",
    "population": "Population impacted",
}


@dataclass
class PriorityContext:
    max_demand: float
    max_population: float
    delivered_7d: dict[str, int] = field(default_factory=dict)  # community_id -> litres delivered in last 7 days


@dataclass
class PriorityResult:
    score: int
    subscores: dict[str, float]
    contributions: dict[str, float]  # points each factor adds to the final score
    explanation: str


def vulnerability_level(score: float) -> str:
    if score >= 85:
        return "Very High"
    if score >= 65:
        return "High"
    if score >= 45:
        return "Medium"
    return "Low"


def score_community(community, weights: dict[str, float], ctx: PriorityContext, days_without_water: int | None = None,
                    demand_override: float | None = None) -> PriorityResult:
    demand = float(demand_override or community.daily_demand or 1)
    allocated = float(community.allocated_water or 0)
    unmet = max(0.0, min(100.0, 100 * (demand - allocated) / demand))
    if days_without_water:
        unmet = max(unmet, min(100.0, 25.0 * days_without_water))

    delivered = ctx.delivered_7d.get(community.id)
    if delivered is not None:
        coverage_7d = min(100.0, 100 * delivered / (7 * demand))
    else:
        coverage_7d = min(100.0, 100 * float(community.previous_allocation or allocated) / demand)

    sub = {
        "demand": min(100.0, 100 * demand / max(ctx.max_demand, 1)),
        "vulnerability": float(community.vulnerability_score),
        "unmetNeed": unmet,
        "previousCoverage": 100 - coverage_7d,
        "population": min(100.0, 100 * community.population / max(ctx.max_population, 1)),
    }
    wsum = sum(max(0.0, weights.get(k, 0.0)) for k in sub) or 1.0
    contrib = {k: max(0.0, weights.get(k, 0.0)) * v / wsum for k, v in sub.items()}
    score = int(round(sum(contrib.values())))

    top = sorted(contrib.items(), key=lambda kv: -kv[1])[:3]
    parts = [f"{FACTOR_LABELS[k].lower()} {sub[k]:.0f}/100 (+{c:.1f} pts)" for k, c in top]
    explanation = f"Priority {score}/100 driven by " + ", ".join(parts) + "."
    return PriorityResult(score, {k: round(v, 1) for k, v in sub.items()}, {k: round(v, 1) for k, v in contrib.items()}, explanation)


def urgency_from_score(score: int) -> str:
    if score >= 75:
        return "Critical"
    if score >= 60:
        return "High"
    if score >= 40:
        return "Medium"
    return "Low"


def level_from_subscore(v: float) -> str:
    if v >= 80:
        return "CRITICAL"
    if v >= 60:
        return "HIGH"
    if v >= 35:
        return "MEDIUM"
    return "LOW"
