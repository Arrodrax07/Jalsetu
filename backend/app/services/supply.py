"""Water balance of a community, in one place.

    available  = baseline_supply (piped/municipal estimate) + allocated_water (approved tanker allocation)
    shortfall  = daily_demand - available
    tanker_need = daily_demand - baseline_supply   (what the tanker system is responsible for)

Communities created by hand keep baseline_supply = 0, i.e. tankers are their only supply.
"""
from __future__ import annotations


def available(c) -> int:
    return int((c.baseline_supply or 0) + (c.allocated_water or 0))


def shortfall(c) -> int:
    return max(0, int(c.daily_demand or 0) - available(c))


def tanker_need(c, demand: float | None = None) -> int:
    d = c.daily_demand if demand is None else demand
    return max(0, int(round(d - (c.baseline_supply or 0))))


def coverage_pct(c) -> int:
    return min(100, round(100 * available(c) / c.daily_demand)) if c.daily_demand else 0
