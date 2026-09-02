import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit

from config import (
    BENCHMARK_TICKERS,
    MODEL_DIR,
    MODEL_TICKERS,
    PROCESSED_DATA_DIR,
    RAW_DATA_DIR,
)
from features import FEATURES, load_benchmarks, make_features


N_WALK_FORWARD_SPLITS = 5
HOLDOUT_FRACTION = 0.2


def build_model() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=300,
        min_samples_leaf=10,
        random_state=42,
        n_jobs=-1,
    )


def evaluate_predictions(actual: pd.Series, predictions: np.ndarray) -> dict:
    actual_values = actual.to_numpy()
    return {
        "model_mae": float(mean_absolute_error(actual_values, predictions)),
        "zero_return_mae": float(
            mean_absolute_error(actual_values, np.zeros(len(actual_values)))
        ),
        "direction_accuracy": float(
            np.mean(np.sign(predictions) == np.sign(actual_values))
        ),
    }


def walk_forward_validate(training_data: pd.DataFrame) -> list[dict]:
    splitter = TimeSeriesSplit(n_splits=N_WALK_FORWARD_SPLITS, gap=1)
    fold_metrics = []

    for fold, (train_indices, validation_indices) in enumerate(
        splitter.split(training_data), start=1
    ):
        fold_train = training_data.iloc[train_indices]
        fold_validation = training_data.iloc[validation_indices]
        model = build_model()
        model.fit(fold_train[list(FEATURES)], fold_train["target"])
        predictions = model.predict(fold_validation[list(FEATURES)])
        metrics = evaluate_predictions(fold_validation["target"], predictions)
        metrics.update(
            {
                "fold": fold,
                "train_start": fold_train["date"].iloc[0].isoformat(),
                "train_end": fold_train["date"].iloc[-1].isoformat(),
                "validation_start": fold_validation["date"].iloc[0].isoformat(),
                "validation_end": fold_validation["date"].iloc[-1].isoformat(),
            }
        )
        fold_metrics.append(metrics)

        print(
            f"  Fold {fold}: MAE={metrics['model_mae']:.6f}, "
            f"baseline={metrics['zero_return_mae']:.6f}, "
            f"direction={metrics['direction_accuracy']:.2%}"
        )

    return fold_metrics


def train_ticker(ticker: str, benchmarks: dict[str, pd.DataFrame]) -> None:
    input_path = RAW_DATA_DIR / f"{ticker}.csv"
    if not input_path.exists():
        raise FileNotFoundError(
            f"Missing {input_path}. Run src/download_data.py after configuring Tiingo."
        )

    data = make_features(
        pd.read_csv(input_path), benchmarks=benchmarks, include_target=True
    )
    if len(data) < 200:
        raise RuntimeError(f"Not enough usable observations to train {ticker}.")

    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
    data.to_csv(PROCESSED_DATA_DIR / f"{ticker}_features.csv", index=False)

    split_index = int(len(data) * (1 - HOLDOUT_FRACTION))
    training_data = data.iloc[:split_index]
    holdout_data = data.iloc[split_index:]

    print(f"\n{ticker} walk-forward validation")
    fold_metrics = walk_forward_validate(training_data)

    evaluation_model = build_model()
    evaluation_model.fit(training_data[list(FEATURES)], training_data["target"])
    holdout_predictions = evaluation_model.predict(holdout_data[list(FEATURES)])
    holdout_metrics = evaluate_predictions(holdout_data["target"], holdout_predictions)

    print(f"{ticker} final unseen holdout")
    print(f"  Training observations: {len(training_data):,}")
    print(f"  Holdout observations:  {len(holdout_data):,}")
    print(f"  Model MAE:             {holdout_metrics['model_mae']:.6f}")
    print(f"  Zero-return MAE:       {holdout_metrics['zero_return_mae']:.6f}")
    print(f"  Direction accuracy:    {holdout_metrics['direction_accuracy']:.2%}")

    # After honest validation, fit the deployable model on every labeled row.
    production_model = build_model()
    production_model.fit(data[list(FEATURES)], data["target"])

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    output_path = MODEL_DIR / f"{ticker}_random_forest.joblib"
    joblib.dump(
        {
            "ticker": ticker,
            "model": production_model,
            "features": list(FEATURES),
            "benchmarks": list(BENCHMARK_TICKERS),
            "trained_through": data["date"].iloc[-1].isoformat(),
            "validation": {
                "strategy": "five expanding walk-forward folds plus final 20% holdout",
                "gap_trading_days": 1,
                "walk_forward_folds": fold_metrics,
                "holdout": holdout_metrics,
            },
        },
        output_path,
    )
    print(f"Saved full-history production model to {output_path}")


def main() -> None:
    benchmarks = load_benchmarks(RAW_DATA_DIR, BENCHMARK_TICKERS)
    for ticker in MODEL_TICKERS:
        train_ticker(ticker, benchmarks)


if __name__ == "__main__":
    main()
