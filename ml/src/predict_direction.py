import argparse

import joblib
import pandas as pd

from config import (
    BENCHMARK_TICKERS,
    DIRECTION_HORIZONS,
    MODEL_DIR,
    MODEL_TICKERS,
    RAW_DATA_DIR,
)
from features import load_benchmarks
from paper_features import make_direction_features


def predict_ticker(ticker: str, horizons: tuple[int, ...]) -> None:
    data_path = RAW_DATA_DIR / f"{ticker}.csv"
    if not data_path.exists():
        raise FileNotFoundError(f"Missing market data: {data_path}")

    raw_data = pd.read_csv(data_path)
    benchmarks = load_benchmarks(RAW_DATA_DIR, BENCHMARK_TICKERS)
    print(f"\n{ticker} direction forecast")

    for horizon in horizons:
        model_path = MODEL_DIR / f"{ticker}_direction_{horizon}d.joblib"
        if not model_path.exists():
            raise FileNotFoundError(
                f"Missing trained classifier: {model_path}. "
                f"Run train_direction.py --ticker {ticker} --horizon {horizon}."
            )

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
        predicted_direction = "RISE" if probability_up >= 0.5 else "FALL"
        confidence = probability_up if probability_up >= 0.5 else 1 - probability_up

        print(
            f"  {horizon:>2} trading day(s): {predicted_direction:<4} | "
            f"P(rise)={probability_up:.2%} | confidence={confidence:.2%}"
        )

    latest_date = pd.to_datetime(raw_data["date"], utc=True).max().date()
    print(f"  Latest market observation: {latest_date}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Predict stock direction with paper-inspired classifiers."
    )
    parser.add_argument("ticker", choices=MODEL_TICKERS, type=str.upper)
    parser.add_argument("--horizon", choices=DIRECTION_HORIZONS, type=int)
    args = parser.parse_args()

    horizons = (args.horizon,) if args.horizon else DIRECTION_HORIZONS
    predict_ticker(args.ticker, horizons)


if __name__ == "__main__":
    main()
