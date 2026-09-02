import argparse

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import TimeSeriesSplit

from config import (
    BENCHMARK_TICKERS,
    DIRECTION_HORIZONS,
    EXPONENTIAL_SMOOTHING_ALPHA,
    MODEL_DIR,
    MODEL_TICKERS,
    PROCESSED_DATA_DIR,
    RAW_DATA_DIR,
)
from features import load_benchmarks
from paper_features import DIRECTION_FEATURES, make_direction_features


N_WALK_FORWARD_SPLITS = 5
HOLDOUT_FRACTION = 0.2


def build_classifier() -> RandomForestClassifier:
    return RandomForestClassifier(
        n_estimators=300,
        min_samples_leaf=10,
        class_weight="balanced_subsample",
        bootstrap=True,
        oob_score=True,
        random_state=42,
        n_jobs=-1,
    )


def positive_probabilities(
    model: RandomForestClassifier, features: pd.DataFrame
) -> np.ndarray:
    classes = list(model.classes_)
    if 1 not in classes:
        raise RuntimeError("Classifier was trained without any positive examples.")
    return model.predict_proba(features)[:, classes.index(1)]


def evaluate_predictions(
    actual: pd.Series,
    probability_up: np.ndarray,
    baseline_class: int,
) -> dict:
    actual_values = actual.astype(int).to_numpy()
    predictions = (probability_up >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(
        actual_values, predictions, labels=[0, 1]
    ).ravel()
    specificity = tn / (tn + fp) if tn + fp else 0.0
    auc = (
        float(roc_auc_score(actual_values, probability_up))
        if len(np.unique(actual_values)) == 2
        else None
    )

    return {
        "accuracy": float(accuracy_score(actual_values, predictions)),
        "balanced_accuracy": float(
            balanced_accuracy_score(actual_values, predictions)
        ),
        "precision": float(
            precision_score(actual_values, predictions, zero_division=0)
        ),
        "recall": float(recall_score(actual_values, predictions, zero_division=0)),
        "specificity": float(specificity),
        "roc_auc": auc,
        "brier_score": float(brier_score_loss(actual_values, probability_up)),
        "majority_baseline_accuracy": float(
            accuracy_score(actual_values, np.full(len(actual_values), baseline_class))
        ),
        "samples": int(len(actual_values)),
    }


def print_metrics(prefix: str, metrics: dict) -> None:
    auc_text = "n/a" if metrics["roc_auc"] is None else f"{metrics['roc_auc']:.3f}"
    print(
        f"{prefix}: accuracy={metrics['accuracy']:.2%}, "
        f"balanced={metrics['balanced_accuracy']:.2%}, "
        f"baseline={metrics['majority_baseline_accuracy']:.2%}, "
        f"AUC={auc_text}, Brier={metrics['brier_score']:.4f}"
    )


def walk_forward_validate(data: pd.DataFrame, horizon: int) -> list[dict]:
    # The gap purges labels whose future price overlaps the validation window.
    splitter = TimeSeriesSplit(n_splits=N_WALK_FORWARD_SPLITS, gap=horizon)
    results = []

    for fold, (train_indices, validation_indices) in enumerate(splitter.split(data), 1):
        fold_train = data.iloc[train_indices]
        fold_validation = data.iloc[validation_indices]
        baseline_class = int(fold_train["target_direction"].mean() >= 0.5)

        model = build_classifier()
        model.fit(
            fold_train[list(DIRECTION_FEATURES)],
            fold_train["target_direction"].astype(int),
        )
        probability_up = positive_probabilities(
            model, fold_validation[list(DIRECTION_FEATURES)]
        )
        metrics = evaluate_predictions(
            fold_validation["target_direction"], probability_up, baseline_class
        )
        metrics.update(
            {
                "fold": fold,
                "train_start": fold_train["date"].iloc[0].isoformat(),
                "train_end": fold_train["date"].iloc[-1].isoformat(),
                "validation_start": fold_validation["date"].iloc[0].isoformat(),
                "validation_end": fold_validation["date"].iloc[-1].isoformat(),
            }
        )
        results.append(metrics)
        print_metrics(f"  Fold {fold}", metrics)

    return results


def train_ticker_horizon(
    ticker: str,
    horizon: int,
    benchmarks: dict[str, pd.DataFrame],
) -> None:
    input_path = RAW_DATA_DIR / f"{ticker}.csv"
    if not input_path.exists():
        raise FileNotFoundError(
            f"Missing {input_path}. Run src/download_data.py before training."
        )

    data = make_direction_features(
        pd.read_csv(input_path),
        benchmarks=benchmarks,
        horizon=horizon,
        smoothing_alpha=EXPONENTIAL_SMOOTHING_ALPHA,
        include_target=True,
    )
    if len(data) < 300:
        raise RuntimeError(
            f"Not enough usable observations for {ticker} at horizon {horizon}."
        )

    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
    processed_path = PROCESSED_DATA_DIR / f"{ticker}_direction_{horizon}d.csv"
    data.to_csv(processed_path, index=False)

    split_index = int(len(data) * (1 - HOLDOUT_FRACTION))
    training_data = data.iloc[:split_index]
    holdout_data = data.iloc[split_index:]

    print(f"\n{ticker} - {horizon}-day direction walk-forward validation")
    fold_metrics = walk_forward_validate(training_data, horizon)

    baseline_class = int(training_data["target_direction"].mean() >= 0.5)
    evaluation_model = build_classifier()
    evaluation_model.fit(
        training_data[list(DIRECTION_FEATURES)],
        training_data["target_direction"].astype(int),
    )
    holdout_probability = positive_probabilities(
        evaluation_model, holdout_data[list(DIRECTION_FEATURES)]
    )
    holdout_metrics = evaluate_predictions(
        holdout_data["target_direction"], holdout_probability, baseline_class
    )
    print_metrics("  Final unseen holdout", holdout_metrics)

    production_model = build_classifier()
    production_model.fit(
        data[list(DIRECTION_FEATURES)], data["target_direction"].astype(int)
    )
    feature_importance = dict(
        sorted(
            zip(DIRECTION_FEATURES, production_model.feature_importances_),
            key=lambda item: item[1],
            reverse=True,
        )
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    output_path = MODEL_DIR / f"{ticker}_direction_{horizon}d.joblib"
    joblib.dump(
        {
            "ticker": ticker,
            "horizon": horizon,
            "model": production_model,
            "features": list(DIRECTION_FEATURES),
            "benchmarks": list(BENCHMARK_TICKERS),
            "smoothing_alpha": EXPONENTIAL_SMOOTHING_ALPHA,
            "trained_through": data["date"].iloc[-1].isoformat(),
            "feature_importance": feature_importance,
            "oob_score": float(production_model.oob_score_),
            "validation": {
                "strategy": "five expanding walk-forward folds plus final 20% holdout",
                "gap_trading_days": horizon,
                "walk_forward_folds": fold_metrics,
                "holdout": holdout_metrics,
            },
        },
        output_path,
    )
    print(f"  OOB score (diagnostic only): {production_model.oob_score_:.2%}")
    print(f"  Saved model to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train paper-inspired stock-direction classifiers."
    )
    parser.add_argument("--ticker", choices=MODEL_TICKERS, type=str.upper)
    parser.add_argument("--horizon", choices=DIRECTION_HORIZONS, type=int)
    args = parser.parse_args()

    tickers = (args.ticker,) if args.ticker else MODEL_TICKERS
    horizons = (args.horizon,) if args.horizon else DIRECTION_HORIZONS
    benchmarks = load_benchmarks(RAW_DATA_DIR, BENCHMARK_TICKERS)

    for ticker in tickers:
        for horizon in horizons:
            train_ticker_horizon(ticker, horizon, benchmarks)


if __name__ == "__main__":
    main()
