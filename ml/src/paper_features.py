import numpy as np
import pandas as pd

from features import FEATURES, make_features


RSI_PERIOD = 14
OSCILLATOR_PERIOD = 14
ROC_PERIOD = 10

TECHNICAL_FEATURES = (
    "rsi_14",
    "stochastic_k_14",
    "williams_r_14",
    "macd",
    "macd_signal",
    "macd_histogram",
    "price_roc_10",
    "obv",
)

DIRECTION_FEATURES = FEATURES + TECHNICAL_FEATURES


def _validate_ohlcv(frame: pd.DataFrame) -> None:
    required = {"date", "adjHigh", "adjLow", "adjClose", "adjVolume"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(
            f"Dataset is missing paper-model columns: {sorted(missing)}"
        )


def _technical_indicators(frame: pd.DataFrame, alpha: float) -> pd.DataFrame:
    if not 0 < alpha <= 1:
        raise ValueError("Smoothing alpha must be greater than 0 and at most 1.")

    _validate_ohlcv(frame)
    technical = frame[["date", "adjHigh", "adjLow", "adjClose", "adjVolume"]].copy()
    technical["date"] = pd.to_datetime(technical["date"], utc=True)
    technical = technical.sort_values("date")

    # Recursive EWMs are causal: each row depends only on that row and its past.
    close = technical["adjClose"].ewm(alpha=alpha, adjust=False).mean()
    high = technical["adjHigh"].ewm(alpha=alpha, adjust=False).mean()
    low = technical["adjLow"].ewm(alpha=alpha, adjust=False).mean()
    volume = technical["adjVolume"].ewm(alpha=alpha, adjust=False).mean()

    delta = close.diff()
    average_gain = delta.clip(lower=0).rolling(RSI_PERIOD).mean()
    average_loss = (-delta.clip(upper=0)).rolling(RSI_PERIOD).mean()
    relative_strength = average_gain / average_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + relative_strength))
    rsi = rsi.mask((average_loss == 0) & (average_gain > 0), 100.0)
    rsi = rsi.mask((average_gain == 0) & (average_loss > 0), 0.0)
    technical["rsi_14"] = rsi

    lowest_low = low.rolling(OSCILLATOR_PERIOD).min()
    highest_high = high.rolling(OSCILLATOR_PERIOD).max()
    price_range = (highest_high - lowest_low).replace(0, np.nan)
    technical["stochastic_k_14"] = 100 * (close - lowest_low) / price_range
    technical["williams_r_14"] = -100 * (highest_high - close) / price_range

    ema_12 = close.ewm(span=12, adjust=False).mean()
    ema_26 = close.ewm(span=26, adjust=False).mean()
    technical["macd"] = ema_12 - ema_26
    technical["macd_signal"] = technical["macd"].ewm(span=9, adjust=False).mean()
    technical["macd_histogram"] = technical["macd"] - technical["macd_signal"]
    technical["price_roc_10"] = close.pct_change(ROC_PERIOD)

    signed_volume = np.sign(close.diff()).fillna(0) * volume
    technical["obv"] = signed_volume.cumsum()

    return technical[["date", *TECHNICAL_FEATURES]]


def make_direction_features(
    frame: pd.DataFrame,
    benchmarks: dict[str, pd.DataFrame],
    horizon: int,
    smoothing_alpha: float,
    include_target: bool = True,
) -> pd.DataFrame:
    if horizon < 1:
        raise ValueError("Forecast horizon must be at least one trading day.")

    base = make_features(frame, benchmarks=benchmarks, include_target=False)
    technical = _technical_indicators(frame, smoothing_alpha)
    featured = base.merge(technical, on="date", how="left", validate="one_to_one")
    featured = featured.replace([np.inf, -np.inf], np.nan)

    required_output = list(DIRECTION_FEATURES)
    if include_target:
        future_close = featured["adjClose"].shift(-horizon)
        featured["forward_return"] = np.log(future_close / featured["adjClose"])
        featured["target_direction"] = np.where(
            future_close.notna(),
            (future_close > featured["adjClose"]).astype(int),
            np.nan,
        )
        required_output.extend(("forward_return", "target_direction"))

    return featured.dropna(subset=required_output)
