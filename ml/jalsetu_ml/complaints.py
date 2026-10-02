"""Complaint triage: category + severity classification and near-duplicate detection.

Model: TF-IDF (word 1-2 grams + character 2-5 grams, so it copes with Devanagari,
Hinglish spelling variation and typos) feeding a class-balanced logistic regression.
Two independent heads: ``category`` and ``severity``.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.pipeline import FeatureUnion, Pipeline

from . import __version__, config
from .complaint_corpus import generate

log = logging.getLogger(__name__)


EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def _normalise(text: str) -> str:
    return " ".join(str(text).split()).lower()


class SentenceEmbedder(BaseEstimator, TransformerMixin):
    """Pretrained multilingual sentence embeddings (ONNX via fastembed, no PyTorch).

    The ONNX session is not pickled; it is re-created lazily after loading.
    """

    def __init__(self, model_name: str = EMBEDDING_MODEL, weight: float = 1.0):
        self.model_name = model_name
        self.weight = weight

    def _model(self):
        if getattr(self, "_m", None) is None:
            os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
            from fastembed import TextEmbedding

            cache = config.ARTIFACTS_DIR / "embeddings_cache"
            cache.mkdir(parents=True, exist_ok=True)
            self._m = TextEmbedding(self.model_name, cache_dir=str(cache))
        return self._m

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        texts = [str(x) for x in X]
        cache = self.__dict__.setdefault("_cache", {})
        missing = list(dict.fromkeys(t for t in texts if t not in cache))
        if missing:
            for t, v in zip(missing, self._model().embed(missing, batch_size=128)):
                v = np.asarray(v, dtype=np.float32)
                cache[t] = v / (np.linalg.norm(v) + 1e-9)
        vecs = np.stack([cache[t] for t in texts])
        if len(cache) > 50_000:  # bound memory in long-running servers
            cache.clear()
        return vecs * self.weight

    def __getstate__(self):
        state = self.__dict__.copy()
        state.pop("_m", None)
        state.pop("_cache", None)
        return state


def embeddings_available() -> bool:
    try:
        import fastembed  # noqa: F401
        return True
    except ImportError:
        return False


def build_pipeline(C: float = 4.0, use_embeddings: bool | None = None) -> Pipeline:
    if use_embeddings is None:
        use_embeddings = embeddings_available()
    parts = [
        ("word", TfidfVectorizer(preprocessor=_normalise, ngram_range=(1, 2), min_df=2, sublinear_tf=True)),
        ("char", TfidfVectorizer(preprocessor=_normalise, analyzer="char_wb", ngram_range=(2, 5), min_df=3, sublinear_tf=True, max_features=120_000)),
    ]
    if use_embeddings:
        parts.append(("embed", SentenceEmbedder(weight=1.5)))
    clf = LogisticRegression(C=C, max_iter=4000, class_weight="balanced")
    return Pipeline([("features", FeatureUnion(parts)), ("clf", clf)])


def _evaluate(pipe: Pipeline, X: pd.Series, y: pd.Series, labels: list[str]) -> dict:
    pred = pipe.predict(X)
    return {
        "n": int(len(y)),
        "accuracy": round(float(accuracy_score(y, pred)), 4),
        "macro_f1": round(float(f1_score(y, pred, average="macro", labels=labels, zero_division=0)), 4),
        "per_class": {
            k: {m: round(float(v), 4) for m, v in d.items()}
            for k, d in classification_report(y, pred, labels=labels, output_dict=True, zero_division=0).items()
            if k in labels
        },
        "confusion_matrix": {"labels": labels, "matrix": confusion_matrix(y, pred, labels=labels).tolist()},
    }


def load_db_labels(db_url: str) -> pd.DataFrame:
    """Officer-verified complaints exported straight from the JalSetu database."""
    from sqlalchemy import create_engine, text

    engine = create_engine(db_url)
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT description AS text, category, severity FROM complaints WHERE label_verified = :t"
        ), {"t": True}).mappings().all()
    df = pd.DataFrame(rows, columns=["text", "category", "severity"])
    df = df[df["category"].isin(config.COMPLAINT_CATEGORIES) & df["severity"].isin(config.SEVERITIES)]
    df["language"] = "real"
    return df


def train(n_train: int = 14000, n_holdout: int = 3000, db_url: str | None = None, out: Path | None = None) -> dict:
    config.ensure_dirs()
    out = out or config.COMPLAINT_MODEL_PATH
    t0 = time.time()

    train_df = generate(n_train, holdout=False, seed=7)
    test_df = generate(n_holdout, holdout=True, seed=11)
    weights = np.ones(len(train_df))

    real_df = pd.DataFrame()
    if db_url:
        real_df = load_db_labels(db_url)
        log.info("Loaded %d officer-verified complaints from DB", len(real_df))
        if len(real_df) >= 10:
            # Keep 20% of real labels for evaluation; real examples are up-weighted 5x.
            real_test = real_df.sample(frac=0.2, random_state=1)
            real_train = real_df.drop(real_test.index)
            train_df = pd.concat([train_df, real_train], ignore_index=True)
            weights = np.concatenate([weights, np.full(len(real_train), 5.0)])
            test_df = pd.concat([test_df, real_test], ignore_index=True)

    heads = {}
    metrics = {}
    for target, labels in (("category", config.COMPLAINT_CATEGORIES), ("severity", config.SEVERITIES)):
        pipe = build_pipeline()
        pipe.fit(train_df["text"], train_df[target], clf__sample_weight=weights)
        heads[target] = pipe
        metrics[target] = {
            "holdout_unseen_phrasings": _evaluate(pipe, test_df["text"], test_df[target], labels),
            "by_language": {
                lang: round(float(accuracy_score(g[target], pipe.predict(g["text"]))), 4)
                for lang, g in test_df.groupby("language")
            },
        }

    bundle = {
        "heads": heads,
        "meta": {
            "model": "tfidf(word1-2+char2-5)" + (" + multilingual MiniLM embeddings" if embeddings_available() else "") + " -> logistic regression",
            "version": __version__,
            "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "n_train": int(len(train_df)),
            "n_real_labels": int(len(real_df)),
            "train_seconds": round(time.time() - t0, 1),
        },
        "metrics": metrics,
    }
    joblib.dump(bundle, out, compress=3)
    _write_metrics("complaint_classifier", {"meta": bundle["meta"], "metrics": metrics})
    return bundle


def _write_metrics(key: str, payload: dict) -> None:
    current = {}
    if config.METRICS_PATH.exists():
        current = json.loads(config.METRICS_PATH.read_text(encoding="utf-8"))
    current[key] = payload
    config.METRICS_PATH.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------
@dataclass
class TriageResult:
    category: str
    category_confidence: float
    severity: str
    severity_confidence: float
    category_probabilities: dict[str, float] = field(default_factory=dict)


class ComplaintTriage:
    def __init__(self, path: Path | None = None):
        path = path or config.COMPLAINT_MODEL_PATH
        if not Path(path).exists():
            raise FileNotFoundError(f"Complaint model not found at {path}. Run `python -m jalsetu_ml.train complaints`.")
        bundle = joblib.load(path)
        self.heads = bundle["heads"]
        self.meta = bundle["meta"]
        self.metrics = bundle["metrics"]

    def predict(self, text: str) -> TriageResult:
        out = {}
        for target in ("category", "severity"):
            pipe = self.heads[target]
            proba = pipe.predict_proba([text])[0]
            classes = list(pipe.classes_)
            i = int(np.argmax(proba))
            out[target] = (classes[i], float(proba[i]), dict(zip(classes, map(float, proba))))
        return TriageResult(
            category=out["category"][0],
            category_confidence=round(out["category"][1], 4),
            severity=out["severity"][0],
            severity_confidence=round(out["severity"][1], 4),
            category_probabilities={k: round(v, 4) for k, v in sorted(out["category"][2].items(), key=lambda kv: -kv[1])},
        )

    @property
    def embedder(self) -> "SentenceEmbedder | None":
        steps = dict(self.heads["category"].named_steps["features"].transformer_list)
        return steps.get("embed")


def find_duplicates(text: str, candidates: list[tuple[str, str]], threshold: float = 0.5,
                    embedder: "SentenceEmbedder | None" = None, semantic_threshold: float = 0.78) -> list[tuple[str, float]]:
    """Return (candidate_id, similarity) for candidates that look like the same grievance.

    Two signals, either is sufficient:
    * character 3-5-gram TF-IDF cosine (robust to typos/transliteration within one script)
    * multilingual sentence-embedding cosine (catches paraphrases and Hindi/Marathi <-> English)
    Callers should restrict ``candidates`` to the same community and recent window.
    """
    if not candidates:
        return []
    ids = [c[0] for c in candidates]
    docs = [_normalise(c[1]) for c in candidates]
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
    mat = vec.fit_transform(docs + [_normalise(text)])
    char_sims = cosine_similarity(mat[-1], mat[:-1]).ravel()

    sem_sims = np.zeros(len(ids))
    if embedder is not None:
        e = embedder.transform([text] + [c[1] for c in candidates]) / max(embedder.weight, 1e-9)
        sem_sims = e[1:] @ e[0]

    hits = []
    for i, cid in enumerate(ids):
        if char_sims[i] >= threshold:
            hits.append((cid, round(float(char_sims[i]), 4)))
        elif sem_sims[i] >= semantic_threshold:
            hits.append((cid, round(float(sem_sims[i]), 4)))
    return sorted(hits, key=lambda h: -h[1])
