import argparse

import joblib
import numpy as np
import pandas as pd

from config import BENCHMARK_TICKERS, MODEL_DIR, MODEL_TICKERS, RAW_DATA_DIR
from features import load_benchmarks, make_features


def predict_next_return(ticker: str) -> None:
    ticker = ticker.upper()
    model_path = MODEL_DIR / f"{ticker}_random_forest.joblib"
    data_path = RAW_DATA_DIR / f"{ticker}.csv"

    if not model_path.exists():
        raise FileNotFoundError(f"Missing trained model: {model_path}")
    if not data_path.exists():
        raise FileNotFoundError(f"Missing market data: {data_path}")

    bundle = joblib.load(model_path)
    data = pd.read_csv(data_path)
    benchmarks = load_benchmarks(RAW_DATA_DIR, BENCHMARK_TICKERS)
    featured = make_features(data, benchmarks=benchmarks, include_target=False)
    latest = featured.iloc[-1]

    feature_names = bundle["features"]
    feature_row = latest[feature_names].to_frame().T
    predicted_return = float(bundle["model"].predict(feature_row)[0])
    latest_close = float(latest["adjClose"])
    predicted_close = latest_close * np.exp(predicted_return)

    print(f"Ticker:                 {ticker}")
    print(f"Latest observation:     {latest['date'].date()}")
    print(f"Latest adjusted close:  ${latest_close:.2f}")
    print(f"Predicted next return:  {predicted_return:.4%}")
    print(f"Implied adjusted close: ${predicted_close:.2f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict the next daily stock return.")
    parser.add_argument("ticker", choices=MODEL_TICKERS, type=str.upper)
    args = parser.parse_args()
    predict_next_return(args.ticker)


if __name__ == "__main__":
    main()
