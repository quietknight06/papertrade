from pathlib import Path


ML_ROOT = Path(__file__).resolve().parent.parent
RAW_DATA_DIR = ML_ROOT / "data" / "raw"
PROCESSED_DATA_DIR = ML_ROOT / "data" / "processed"
MODEL_DIR = ML_ROOT / "models"

# Keep this aligned with backend/index.js fallbackPrices.
MODEL_TICKERS = ("AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA")

# These ETFs provide broad-market and technology-sector context. They are used
# as model inputs but do not receive their own forecast models.
BENCHMARK_TICKERS = ("SPY", "QQQ")
DOWNLOAD_TICKERS = MODEL_TICKERS + BENCHMARK_TICKERS

# Paper-inspired direction-classification settings. Horizons are measured in
# trading observations, not calendar days.
DIRECTION_HORIZONS = (1, 5, 20)
EXPONENTIAL_SMOOTHING_ALPHA = 0.2
