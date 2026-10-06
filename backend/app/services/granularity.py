"""Community detail: whole settlements, or areas inside cities.

Two levels live side by side in ``communities``:

* ``settlement`` - a town, village or whole city (the OpenStreetMap place import, Census populations).
* ``area``       - a suburb / neighbourhood / quarter inside a big city (OpenStreetMap), linked to its city by
                   ``parent_id``. Imported by ``ingestion.areas``.

The admin picks the level (Admin -> Settings -> Community detail; setting ``communities.granularity``):

* ``settlements`` - every settlement is active; areas are inactive (the original view).
* ``areas``       - every city that has areas is replaced by its areas; everything else stays as it is.

Switching only flips ``is_active`` on cities that have areas and on the areas themselves, so allocation, priority,
dispatch, maps, requests and the public portal all follow without knowing about levels. Records already made
against a city (requests, trips, deliveries) keep pointing at it and stay visible in their own lists.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Community
from .common import get_setting, put_setting

MODES = ("settlements", "areas")


def mode(db: Session) -> str:
    m = get_setting(db, "communities").get("granularity", "settlements")
    return m if m in MODES else "settlements"


def summary(db: Session) -> dict:
    areas = db.scalar(select(func.count()).select_from(Community).where(Community.level == "area")) or 0
    split = db.scalars(select(Community.parent_id).where(Community.level == "area").distinct()).all()
    cities = list(db.scalars(select(Community).where(Community.id.in_(split)).order_by(Community.population.desc()))) if split else []
    per_city = dict(db.execute(select(Community.parent_id, func.count()).where(Community.level == "area").group_by(Community.parent_id)).all())
    active = db.scalar(select(func.count()).select_from(Community).where(Community.is_active.is_(True))) or 0
    return {
        "granularity": mode(db),
        "activeCommunities": active,
        "areas": areas,
        "cities": [{"id": c.id, "name": c.name, "population": c.population, "areas": per_city.get(c.id, 0)} for c in cities],
    }


def apply(db: Session, granularity: str) -> dict:
    """Make ``granularity`` the active level; returns how many communities changed state."""
    if granularity not in MODES:
        raise ValueError(f"granularity must be one of {MODES}")
    areas_on = granularity == "areas"
    parents = set(db.scalars(select(Community.parent_id).where(Community.level == "area").distinct()).all())
    changed = 0
    for c in db.scalars(select(Community).where((Community.level == "area") | (Community.id.in_(parents)))):
        want = areas_on if c.level == "area" else not areas_on
        if c.is_active != want:
            c.is_active = want
            changed += 1
    cfg = get_setting(db, "communities")
    cfg["granularity"] = granularity
    put_setting(db, "communities", cfg)
    db.flush()
    return {"changed": changed}
