# JalSetu ML (`jalsetu_ml`)

Training pipelines and inference code for the two learned models in JalSetu. The backend
installs this package in editable mode (`-e ../ml` in `backend/requirements.txt`), so the API
and training share one implementation.

| Model | What it does | Details |
|---|---|---|
| Complaint triage | category + severity for grievances in English / Hinglish / हिंदी / मराठी; duplicate detection | [MODEL_CARD.md §1](MODEL_CARD.md#1-complaint-triage-classifier) |
| Demand forecaster | 1–14-day community water-demand forecast from live weather, with 80% interval | [MODEL_CARD.md §2](MODEL_CARD.md#2-water-demand-forecaster) |

The allocation optimiser and route optimiser are deterministic optimisation, not learned
models; they live in `backend/app/services/`.

## Layout

```
ml/
├── jalsetu_ml/
│   ├── config.py             paths, label spaces, Open-Meteo endpoints
│   ├── weather.py            Open-Meteo archive/forecast client, batched multi-location forecast (+ climatology fallback)
│   ├── complaint_corpus.py   multilingual bootstrap corpus with train/holdout phrase split
│   ├── complaints.py         triage model: train / evaluate / predict, duplicate detection
│   ├── demand.py             demand features, documented simulator, train / evaluate / forecast (forecast_groups: many places in one predict)
│   └── train.py              CLI
├── tests/test_models.py      quality gates (golden set, direction checks, baselines)
├── artifacts/                trained models + metrics.json (models are git-ignored)
├── data/raw/                 cached weather downloads (git-ignored)
├── MODEL_CARD.md
├── pyproject.toml
└── requirements.txt
```

## Setup & training

Uses the backend virtualenv (`..\setup.ps1` does all of this), or standalone:

```bash
cd ml
python -m venv .venv && .venv/Scripts/activate        # Windows (source .venv/bin/activate on Linux/macOS)
pip install -r requirements.txt && pip install -e .

python -m jalsetu_ml.train all          # both models (~5 min; first run downloads ~7 years of weather + 220 MB embedding model)
python -m jalsetu_ml.train complaints   # or one at a time
python -m jalsetu_ml.train demand

pytest tests                            # quality gates
```

### Retraining with real data

```bash
python -m jalsetu_ml.train all --db-url sqlite:///../backend/jalsetu.db
python -m jalsetu_ml.train all --db-url postgresql+psycopg://user:pass@host/jalsetu
```

* Complaints: rows with `label_verified = true` (officers confirmed or corrected the labels in
  the app) are added at 5× weight; 20% of them are held out for evaluation.
* Demand: rows in `demand_observations` (metered daily litres per community) are joined with
  real weather for those dates and added at 10× weight.

Admins can trigger the same thing from **Settings → Machine learning → Retrain**; the API
hot-reloads the new artifacts when training finishes.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `JALSETU_ML_ARTIFACTS` | `ml/artifacts` | where models and metrics are written/read |
| `JALSETU_ML_DATA` | `ml/data` | weather cache |

External services: Open-Meteo (free, no key) and Hugging Face Hub (one-time model download).
