# JalSetu model cards

Both models are trained by `python -m jalsetu_ml.train all`; metrics are regenerated into
`artifacts/metrics.json` on every run and shown live in the app (Settings → Machine learning).
Numbers below are from the 2026-10-02 training run.

---

## 1. Complaint triage classifier

| | |
|---|---|
| **Task** | Classify a free-text water-supply grievance into a **category** (6 classes) and **severity** (Low / Medium / High / Critical) |
| **Languages** | English, Hinglish (romanised Hindi), Hindi (Devanagari), Marathi |
| **Architecture** | `FeatureUnion[ TF-IDF word 1–2-grams, TF-IDF char_wb 2–5-grams, multilingual sentence embeddings ]` → class-balanced logistic regression (one head per target) |
| **Embeddings** | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (ONNX via `fastembed`, 384-d, no PyTorch, ~220 MB, cached in `artifacts/embeddings_cache/`) |
| **Artifact** | `artifacts/complaint_classifier.joblib` (~0.9 MB + embedding model) |
| **Latency** | ~10–30 ms per complaint on a laptop CPU after warm-up |

### Training data — read this

No public, labelled corpus of Indian municipal water grievances exists. The **bootstrap**
model is trained on a *compositional* corpus (`complaint_corpus.py`): hand-written category
phrases × severity cues (health, children, clinic, protest …) × duration ("3 din se",
"गेले 4 दिवस") × locations × openers/closers × typos and casing noise. Severity labels follow
an explicit municipal triage policy (`label_severity`).

To keep the evaluation honest, **every phrase bank is split**: one third of the phrasings
never appear in training and only appear in the test set. Reported scores therefore measure
generalisation to unseen wording, not template recall.

**Real-data loop:** when officers confirm or correct a complaint's labels in the app, the row
is marked `label_verified`. `python -m jalsetu_ml.train complaints --db-url <DATABASE_URL>`
(or the *Retrain* button) mixes those real examples in at 5× weight and evaluates on a 20%
hold-out of them. Over time real data should dominate. The app also tracks **live agreement**
between the model's original prediction and the officer-verified label (Impact Analytics).

### Results (held-out, unseen phrasings, n = 3,000)

| Head | Accuracy | Macro-F1 |
|---|---|---|
| Category | **80.0%** | 80.4 |
| Severity | **71.0%** | 68.3 |

Category accuracy by language: English 94.7% · Hindi 83.4% · Hinglish 64.0% · Marathi 60.5%.
Per-class category F1: Late Tanker 0.95 · Missed Delivery 0.85 · Insufficient Quantity 0.78 ·
No Water 0.76 · Poor Water Quality 0.75 · Billing/Other 0.74. Severity F1 is highest for
Critical (0.84), which is the class that triggers auto-escalation.

An earlier TF-IDF-only version scored 53% category accuracy on the same split; adding the
pretrained multilingual embeddings is what makes unseen phrasing work.

A hand-written "golden" set (free-form sentences, not from the generator) is a regression
gate in `tests/test_models.py` (≥ 75% required).

### Duplicate detection

Within the same community and a 72-hour window, a new complaint is a duplicate of an open one if
character 3–5-gram TF-IDF cosine ≥ 0.55 **or** (same predicted category **and** embedding cosine
≥ 0.78). Measured: Hindi ↔ English paraphrase 0.89, English paraphrase 0.86, different
grievance same category 0.51.

### Known limitations

* Romanised Hinglish ↔ English semantic matching is weak (MiniLM was not trained on
  transliterated Hindi): cosine 0.27 for a true cross-script duplicate. Character n-grams still
  catch Hinglish ↔ Hinglish duplicates.
* Marathi and Hinglish accuracy trails English; these are the first languages where real
  labelled data will help most.
* Severity depends on cues like "4 days" or health mentions; implicit urgency without such
  cues is under-detected.
* The model is a **triage aid**. Officers see the confidence and can correct any label; low-confidence
  (< 60%) predictions are flagged "Needs review".

---

## 2. Water-demand forecaster

| | |
|---|---|
| **Task** | Forecast each community's daily water need for the next 1–14 days, with an 80% interval |
| **Target** | `demand_index = daily demand / community baseline demand` (so one model serves communities of any size; litres = baseline × index) |
| **Features** | max/min temperature, precipitation, humidity, 3/7/30-day rainfall, 3-day mean max temperature, day of week, weekend flag, seasonal sin/cos, month, community vulnerability score |
| **Architecture** | scikit-learn `HistGradientBoostingRegressor` (median) + two quantile models (P10, P90) |
| **Weather input** | **Real** Open-Meteo data: ERA5 reanalysis archive for training (Mumbai, 2019-01-01 → 2025-12-31); live 16-day forecast + 30 past days at inference. Falls back to IMD climate normals if the API is unreachable (reported as `climatology-fallback`). |
| **Artifact** | `artifacts/demand_forecaster.joblib` (~1.1 MB) |

### Training data — read this

The weather is real, but **no public metered daily tanker-demand series exists for Mumbai**.
The bootstrap target is generated by `simulate_demand_index`, an explicit response function:

* +3.5% per °C of daily max above 30 °C, +2% per °C of 3-day mean above 33 °C (heat stress)
* −up to 28% with sustained 30-day rainfall, −8% on very wet days (monsoon recharge of piped supply/wells)
* +6–18% in the dry season (Mar–May, scaled by vulnerability: tanker-reliant settlements are hit harder)
* +6% Sundays, +3% Saturdays; AR(1) noise (σ ≈ 3.5%)

The model therefore learns *this documented hypothesis* from real weather. That is useful for
planning (it reacts correctly to heat waves and monsoon onset) but it is **not** a claim about
observed Mumbai consumption.

**Real-data loop:** `POST /api/demand-observations` (or bulk import) records actual metered daily
litres per community. `train demand --db-url …` joins them with real weather for those dates
and trains with 10× weight. Once a few months of observations exist, the simulator can be
removed from training entirely.

### Results (time-based split: train < 2024-01-01 ≤ test, n_test = 8,772 community-days)

| Model | MAPE | MAE (index) |
|---|---|---|
| **Gradient boosting** | **3.9%** | 0.040 |
| Monthly seasonal average | 8.9% | 0.094 |
| Static baseline (no forecast) | 26.2% | 0.250 |

80% prediction-interval empirical coverage: 73.9% (slightly under-dispersed).

### Known limitations

* Accuracy above is against the simulator's own noise floor, i.e. it measures whether the model
  learned the response function, not real-world error. Real error will only be known after
  observations are recorded.
* One weather location per ~10 km cell (rounded to 0.1°); fine for a city, coarse for a district.
* No festival / event calendar yet.
