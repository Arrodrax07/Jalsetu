"""Live crisis scoring: how strongly current evidence says a community is short of water.

Evidence (``CrisisSignal``):
* rainfall_deficit - measured monsoon rainfall vs the previous 10 years for the community's district;
* news             - a recent article matched to the community, its district, or its region.

    crisis = min(100, rain + min(45, community news) + min(20, district/region news))

so district-wide evidence alone (rain + district news <= 50) marks a place High Demand, and Critical needs
the place itself named in a report.

News is unverified until an operator reviews it: confirmed counts x1.25, dismissed counts 0. Region-only
matches (e.g. "Marathwada") count half. Expired signals do not count.

For imported communities (data_origin ``external``) the estimated piped baseline falls with the score:
    baseline_supply = daily_demand x (1 - 0.5 x crisis / 100)
i.e. the worst evidence implies a 50% supply shortfall that tankers must cover (coverage < 85% at
crisis > 30 -> High Demand; < 65% at crisis > 70 -> Critical). Communities entered by
hand keep their own figures.
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import Community, CrisisSignal, utcnow

RAIN_POINTS = {"Severe": 30.0, "Moderate": 18.0, "Minor": 8.0}
NEWS_COMMUNITY_POINTS = {"Severe": 40.0, "Moderate": 25.0, "Minor": 10.0}
NEWS_DISTRICT_POINTS = {"Severe": 20.0, "Moderate": 12.0, "Minor": 5.0}
REVIEW_FACTOR = {"unverified": 1.0, "confirmed": 1.25, "dismissed": 0.0}
MAX_SHORTFALL = 0.5


def active_signals(db: Session) -> list[CrisisSignal]:
    now = utcnow()
    return list(db.scalars(select(CrisisSignal).where(CrisisSignal.status != "dismissed",
                                                      or_(CrisisSignal.expires_at.is_(None), CrisisSignal.expires_at > now))))


def region_only(sig: CrisisSignal) -> bool:
    scopes = {m.get("scope") for m in (sig.matched_terms or []) if isinstance(m, dict)}
    return bool(scopes) and scopes <= {"region"}


def scores(communities: list[Community], signals: list[CrisisSignal]) -> dict[str, tuple[float, list[int]]]:
    """community_id -> (score, ids of the signals that contributed). Pure, for testing."""
    rain, news_c, news_d = defaultdict(float), defaultdict(float), defaultdict(float)
    used: dict[str, list[int]] = defaultdict(list)
    by_district: dict[int, list[str]] = defaultdict(list)
    for c in communities:
        if c.district_id:
            by_district[c.district_id].append(c.id)
    for s in signals:
        f = REVIEW_FACTOR.get(s.status, 1.0)
        if f == 0:
            continue
        if s.kind == "rainfall_deficit":
            for d in s.district_ids or []:
                for cid in by_district.get(d, []):
                    if RAIN_POINTS.get(s.severity, 0) * f > rain[cid]:
                        rain[cid] = RAIN_POINTS.get(s.severity, 0) * f
                    used[cid].append(s.id)
            continue
        direct = set(s.community_ids or [])
        for cid in direct:
            news_c[cid] += NEWS_COMMUNITY_POINTS.get(s.severity, 0) * f
            used[cid].append(s.id)
        half = 0.5 if region_only(s) else 1.0
        for d in s.district_ids or []:
            for cid in by_district.get(d, []):
                if cid not in direct:
                    news_d[cid] += NEWS_DISTRICT_POINTS.get(s.severity, 0) * f * half
                    used[cid].append(s.id)
    out = {}
    for c in communities:
        score = min(100.0, rain[c.id] + min(45.0, news_c[c.id]) + min(20.0, news_d[c.id]))
        out[c.id] = (round(score, 1), sorted(set(used[c.id])))
    return out


def recompute(db: Session) -> dict:
    communities = list(db.scalars(select(Community).where(Community.is_active.is_(True))))
    result = scores(communities, active_signals(db))
    now, raised = utcnow(), 0
    for c in communities:
        score = result[c.id][0]
        if score > (c.crisis_score or 0):
            raised += 1
        c.crisis_score, c.crisis_updated_at = score, now
        if c.data_origin == "external":
            c.baseline_supply = int(round(c.daily_demand * (1 - MAX_SHORTFALL * score / 100)))
    db.commit()
    hot = sorted((c for c in communities if c.crisis_score >= 30), key=lambda c: -c.crisis_score)
    return {"communities": len(communities), "inCrisis": len(hot), "raised": raised,
            "top": [{"id": c.id, "name": c.name, "score": c.crisis_score} for c in hot[:10]]}


def signals_for(signals: list[CrisisSignal], community: Community) -> list[CrisisSignal]:
    return [s for s in signals if community.id in (s.community_ids or []) or (community.district_id in (s.district_ids or []))]
