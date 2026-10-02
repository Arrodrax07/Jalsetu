"""Training CLI.

    python -m jalsetu_ml.train all
    python -m jalsetu_ml.train complaints --db-url sqlite:///../backend/jalsetu.db
    python -m jalsetu_ml.train demand --db-url postgresql+psycopg://...
"""
from __future__ import annotations

import argparse
import json
import logging

from . import complaints, demand


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Train JalSetu ML models")
    parser.add_argument("target", choices=["all", "complaints", "demand"])
    parser.add_argument("--db-url", help="SQLAlchemy URL of the JalSetu DB to mix in real labelled data")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.target in ("all", "complaints"):
        b = complaints.train(db_url=args.db_url)
        print("complaint classifier:", json.dumps({
            "category": {k: b["metrics"]["category"]["holdout_unseen_phrasings"][k] for k in ("accuracy", "macro_f1")},
            "severity": {k: b["metrics"]["severity"]["holdout_unseen_phrasings"][k] for k in ("accuracy", "macro_f1")},
            "meta": b["meta"],
        }, indent=2))
    if args.target in ("all", "demand"):
        b = demand.train(db_url=args.db_url)
        print("demand forecaster:", json.dumps(b["metrics"], indent=2))


if __name__ == "__main__":
    main()
