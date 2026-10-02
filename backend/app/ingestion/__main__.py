"""Ingestion CLI.

    python -m app.ingestion sachet          # pull NDMA SACHET alerts now
    python -m app.ingestion geography       # import state + district boundaries (geoBoundaries)
    python -m app.ingestion lgd FILE.csv    # attach official LGD district codes from an LGD export
    python -m app.ingestion probes          # refresh health of credential-gated sources
    python -m app.ingestion worker          # run background jobs forever (separate worker container)
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

from ..db import SessionLocal, init_db
from .geoboundaries import import_lgd_csv, run_geoboundaries
from .jobs import run_forever
from .probes import probe_imd, probe_static
from .sachet import run_sachet


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    cmd = sys.argv[1]
    init_db()
    if cmd == "worker":
        run_forever()
        return
    with SessionLocal() as db:
        if cmd == "probes":
            probe_static(db)
            probe_imd(db)
            print("probes updated")
            return
        if cmd == "lgd":
            print(json.dumps(import_lgd_csv(db, Path(sys.argv[2])), indent=2, ensure_ascii=False))
            return
        runner = {"sachet": run_sachet, "geography": run_geoboundaries}.get(cmd)
        if runner is None:
            print(__doc__)
            sys.exit(2)
        r = runner(db)
        print(json.dumps({"status": r.status, "fetched": r.fetched, "created": r.created, "updated": r.updated,
                          "unchanged": r.unchanged, "error": r.error}, indent=2))


if __name__ == "__main__":
    main()
