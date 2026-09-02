import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from config import BENCHMARK_TICKERS, DIRECTION_HORIZONS, MODEL_DIR, MODEL_TICKERS, RAW_DATA_DIR
from features import load_benchmarks, make_features
from paper_features import make_direction_features


DISCLAIMER = (
    "Experimental machine-learning estimates only. They do not guarantee future "
    "prices or investment results and are not financial advice."
)


def require_file(path: Path, description: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"Missing {description}: {path}")


def holdout_metrics(bundle: dict) -> dict:
    return bundle.get("validation", {}).get("holdout", {})


def price_prediction(
    ticker: str,
    raw_data: pd.DataFrame,
    benchmarks: dict[str, pd.DataFrame],
) -> dict:
    model_path = MODEL_DIR / f"{ticker}_random_forest.joblib"
    require_file(model_path, "price model")
    bundle = joblib.load(model_path)

    featured = make_features(raw_data, benchmarks=benchmarks, include_target=False)
    latest = featured.iloc[-1]
    feature_row = latest[bundle["features"]].to_frame().T
    predicted_return = float(bundle["model"].predict(feature_row)[0])
    adjusted_close = float(latest["adjClose"])

    return {
        "horizonTradingDays": 1,
        "latestAdjustedClose": adjusted_close,
        "predictedReturn": predicted_return,
        "impliedAdjustedClose": float(adjusted_close * np.exp(predicted_return)),
        "trainedThrough": bundle.get("trained_through"),
        "holdout": holdout_metrics(bundle),
    }


def direction_predictions(
    ticker: str,
    raw_data: pd.DataFrame,
    benchmarks: dict[str, pd.DataFrame],
) -> list[dict]:
    predictions = []
    for horizon in DIRECTION_HORIZONS:
        model_path = MODEL_DIR / f"{ticker}_direction_{horizon}d.joblib"
        require_file(model_path, f"{horizon}-day direction model")
        bundle = joblib.load(model_path)
        featured = make_direction_features(
            raw_data,
            benchmarks=benchmarks,
            horizon=horizon,
            smoothing_alpha=bundle["smoothing_alpha"],
            include_target=False,
        )
        latest = featured.iloc[-1]
        feature_row = latest[bundle["features"]].to_frame().T
        model = bundle["model"]
        classes = list(model.classes_)
        probability_up = float(model.predict_proba(feature_row)[0, classes.index(1)])
        ranked_features = list(bundle.get("feature_importance", {}).items())[:3]

        predictions.append(
            {
                "horizonTradingDays": horizon,
                "probabilityUp": probability_up,
                "probabilityDown": 1 - probability_up,
                "predictedDirection": "RISE" if probability_up >= 0.5 else "FALL",
                "confidence": max(probability_up, 1 - probability_up),
                "trainedThrough": bundle.get("trained_through"),
                "holdout": holdout_metrics(bundle),
                "topFeatures": [
                    {"name": name, "importance": float(importance)}
                    for name, importance in ranked_features
                ],
            }
        )
    return predictions


def build_dashboard_prediction(ticker: str) -> dict:
    ticker = ticker.upper()
    if ticker not in MODEL_TICKERS:
        raise ValueError(f"Unsupported ticker: {ticker}")

    data_path = RAW_DATA_DIR / f"{ticker}.csv"
    require_file(data_path, "stock history")
    raw_data = pd.read_csv(data_path)
    benchmarks = load_benchmarks(RAW_DATA_DIR, BENCHMARK_TICKERS)
    latest_date = pd.to_datetime(raw_data["date"], utc=True).max().isoformat()

    return {
        "ticker": ticker,
        "asOf": latest_date,
        "experimental": True,
        "disclaimer": DISCLAIMER,
        "price": price_prediction(ticker, raw_data, benchmarks),
        "directions": direction_predictions(ticker, raw_data, benchmarks),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Return dashboard ML forecasts as JSON.")
    parser.add_argument("--ticker", required=True, choices=MODEL_TICKERS, type=str.upper)
    args = parser.parse_args()
    print(json.dumps(build_dashboard_prediction(args.ticker), allow_nan=False))


if __name__ == "__main__":
    main()
