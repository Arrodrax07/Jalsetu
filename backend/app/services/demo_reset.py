"""Demo reset: save the database as a starting point, and put it back with one press.

For presenting: tankers sent on trips, requests approved, plans computed during a demo can all be returned to the
saved starting point. Saved: every table. Restored: every table EXCEPT people and history, so nobody is signed out
and the record of what happened survives:

* kept as they are: ``users``, ``refresh_tokens`` (sessions), ``audit_logs`` (the reset itself is audited),
  ``alembic_version`` (schema bookkeeping).

SQLite only (the local demo database); the snapshot sits beside it (``jalsetu.db`` -> ``jalsetu.demo-baseline.db``). A snapshot from an
older schema is refused rather than half-restored.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.engine import make_url

from ..config import get_settings
from ..db import engine

KEEP = {"users", "refresh_tokens", "audit_logs", "alembic_version"}


class NotSupported(Exception):
    pass


def _db_path() -> Path:
    url = make_url(get_settings().database_url)
    if not url.drivername.startswith("sqlite") or not url.database:
        raise NotSupported("Demo reset works with the local SQLite database only")
    return Path(url.database)


def baseline_path() -> Path:
    db = _db_path()
    return db.with_name(db.stem + ".demo-baseline.db")


def status() -> dict:
    try:
        BASELINE = baseline_path()
    except NotSupported:
        return {"supported": False, "saved": False, "savedAt": None, "sizeMb": None}
    supported = True
    saved = BASELINE.exists()
    return {"supported": supported, "saved": saved,
            "savedAt": datetime.fromtimestamp(BASELINE.stat().st_mtime, timezone.utc).isoformat(timespec="seconds") if saved else None,
            "sizeMb": round(BASELINE.stat().st_size / 1e6, 1) if saved else None}


def save() -> dict:
    """Snapshot the live database (SQLite online backup: consistent while the app keeps running)."""
    src, BASELINE = _db_path(), baseline_path()
    tmp = BASELINE.with_suffix(".tmp")
    if tmp.exists():
        tmp.unlink()
    live, out = sqlite3.connect(src), sqlite3.connect(tmp)
    try:
        live.backup(out)
    finally:  # (a with-block does not close sqlite3 connections; Windows keeps the file locked)
        out.close(); live.close()
    os.replace(tmp, BASELINE)
    return status()


def _tables(conn: sqlite3.Connection, schema: str) -> list[str]:
    return [r[0] for r in conn.execute(f"SELECT name FROM {schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]


def _columns(conn: sqlite3.Connection, schema: str, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f'PRAGMA {schema}.table_info("{table}")')]


def restore() -> dict:
    """Put every table except people and history back to the saved starting point, in one transaction."""
    BASELINE = baseline_path()
    if not BASELINE.exists():
        raise FileNotFoundError("No starting point saved yet")
    raw = engine.raw_connection()
    conn: sqlite3.Connection = raw.driver_connection  # type: ignore[assignment]
    old_level = conn.isolation_level
    conn.isolation_level = None  # explicit BEGIN/COMMIT below
    restored: dict[str, int] = {}
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.execute("ATTACH DATABASE ? AS snap", (str(BASELINE),))
        try:
            live_v = conn.execute("SELECT version_num FROM main.alembic_version").fetchone()
            snap_v = conn.execute("SELECT version_num FROM snap.alembic_version").fetchone()
            if live_v != snap_v:
                raise RuntimeError(f"The starting point was saved with schema {snap_v and snap_v[0]}, the database is at "
                                   f"{live_v and live_v[0]}. Save a new starting point.")
            snap_tables = set(_tables(conn, "snap"))
            conn.execute("BEGIN IMMEDIATE")
            try:
                for t in _tables(conn, "main"):
                    if t in KEEP or t not in snap_tables:
                        continue
                    cols = [c for c in _columns(conn, "main", t) if c in set(_columns(conn, "snap", t))]
                    names = ", ".join(f'"{c}"' for c in cols)
                    conn.execute(f'DELETE FROM main."{t}"')
                    conn.execute(f'INSERT INTO main."{t}" ({names}) SELECT {names} FROM snap."{t}"')
                    restored[t] = conn.execute(f'SELECT count(*) FROM main."{t}"').fetchone()[0]
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        finally:
            conn.execute("DETACH DATABASE snap")
            conn.execute("PRAGMA foreign_keys=ON")
    finally:
        conn.isolation_level = old_level
        raw.close()
    return {"tables": len(restored), "rows": sum(restored.values()), "tankers": restored.get("tankers"), "trips": restored.get("trips")}
