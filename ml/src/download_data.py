import os

import pandas as pd
import requests
from dotenv import load_dotenv

from config import DOWNLOAD_TICKERS, ML_ROOT, RAW_DATA_DIR


def download_ticker(ticker: str, api_key: str) -> pd.DataFrame:
    response = requests.get(
        f"https://api.tiingo.com/tiingo/daily/{ticker}/prices",
        params={
            "startDate": "1980-01-01",
            "token": api_key,
        },
        timeout=60,
    )
    response.raise_for_status()

    frame = pd.DataFrame(response.json())
    if frame.empty:
        raise RuntimeError(f"Tiingo returned no historical data for {ticker}.")

    frame["date"] = pd.to_datetime(frame["date"], utc=True)
    frame["ticker"] = ticker
    return frame.sort_values("date")


def main() -> None:
    load_dotenv(ML_ROOT / ".env")
    api_key = os.getenv("TIINGO_API_KEY", "").strip()
    if not api_key or api_key == "your_actual_key_here":
        raise RuntimeError("Set TIINGO_API_KEY in ml/.env before downloading data.")

    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)

    for ticker in DOWNLOAD_TICKERS:
        frame = download_ticker(ticker, api_key)
        output_path = RAW_DATA_DIR / f"{ticker}.csv"
        frame.to_csv(output_path, index=False)
        print(f"{ticker}: saved {len(frame):,} rows to {output_path}")


if __name__ == "__main__":
    main()
