from pathlib import Path

import numpy as np
import pandas as pd


STOCK_FEATURES = (
    "return_1d",
    "return_5d",
    "return_20d",
    "volatility_20d",
    "volume_change",
)

MARKET_FEATURES = (
    "spy_return_1d",
    "spy_return_5d",
    "spy_return_20d",
    "spy_volatility_20d",
    "qqq_return_1d",
    "qqq_return_5d",
    "qqq_return_20d",
    "qqq_volatility_20d",
    "relative_to_spy_5d",
    "relative_to_qqq_5d",
)

FEATURES = STOCK_FEATURES + MARKET_FEATURES


def load_benchmarks(
    raw_data_dir: Path, benchmark_tickers: tuple[str, ...]
) -> dict[str, pd.DataFrame]:
    benchmarks = {}
    for ticker in benchmark_tickers:
        path = raw_data_dir / f"{ticker}.csv"
        if not path.exists():
            raise FileNotFoundError(
                f"Missing benchmark data: {path}. Run src/download_data.py first."
            )
        benchmarks[ticker] = pd.read_csv(path)
    return benchmarks


def _benchmark_features(frame: pd.DataFrame, ticker: str) -> pd.DataFrame:
    required = {"date", "adjClose"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(
            f"{ticker} benchmark data is missing columns: {sorted(missing)}"
        )

    prefix = ticker.lower()
    market = frame[["date", "adjClose"]].copy()
    market["date"] = pd.to_datetime(market["date"], utc=True)
    market = market.sort_values("date")

    log_price = np.log(market["adjClose"])
    market[f"{prefix}_return_1d"] = log_price.diff()
    market[f"{prefix}_return_5d"] = log_price.diff(5)
    market[f"{prefix}_return_20d"] = log_price.diff(20)
    market[f"{prefix}_volatility_20d"] = (
        market[f"{prefix}_return_1d"].rolling(20).std()
    )
    return market.drop(columns="adjClose")


def make_features(
    frame: pd.DataFrame,
    benchmarks: dict[str, pd.DataFrame],
    include_target: bool = True,
) -> pd.DataFrame:
    required = {"date", "adjClose", "adjVolume"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Dataset is missing required columns: {sorted(missing)}")

    featured = frame.copy()
    featured["date"] = pd.to_datetime(featured["date"], utc=True)
    featured = featured.sort_values("date")

    log_price = np.log(featured["adjClose"])
    featured["return_1d"] = log_price.diff()
    featured["return_5d"] = log_price.diff(5)
    featured["return_20d"] = log_price.diff(20)
    featured["volatility_20d"] = featured["return_1d"].rolling(20).std()
    featured["volume_change"] = np.log(featured["adjVolume"]).diff()

    for benchmark_ticker, benchmark_frame in benchmarks.items():
        market = _benchmark_features(benchmark_frame, benchmark_ticker)
        featured = featured.merge(market, on="date", how="left", validate="one_to_one")

    featured["relative_to_spy_5d"] = (
        featured["return_5d"] - featured["spy_return_5d"]
    )
    featured["relative_to_qqq_5d"] = (
        featured["return_5d"] - featured["qqq_return_5d"]
    )
    featured = featured.replace([np.inf, -np.inf], np.nan)

    required_output = list(FEATURES)
    if include_target:
        # At row t, predict log(adjClose[t + 1] / adjClose[t]).
        featured["target"] = featured["return_1d"].shift(-1)
        required_output.append("target")

    return featured.dropna(subset=required_output)
