# Stock price forecasting

Python utilities for downloading Tiingo end-of-day data and training two model
families per project ticker. Models use the stock's own history plus `SPY` and
`QQQ` as broad-market context.

- The return regressor estimates the next trading day's numerical return.
- The paper-inspired direction classifier estimates the probability that the
  adjusted close will be higher after 1, 5, or 20 trading days.

## Layout

- `src/`: Python source files and command entry points.
- `data/raw/`: Original Tiingo CSV downloads for six stocks and two benchmarks.
- `data/processed/`: Generated, model-ready feature datasets.
- `models/`: Generated model bundles.

## Setup

Run these commands from this `ml` directory:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env`, then replace the placeholder with your Tiingo
API key. The local `.env`, downloaded data, environments, and models are ignored
by Git.

## Commands

```powershell
# Download six model tickers plus the SPY and QQQ context datasets
python src\download_data.py

# Train all ticker models after reviewing the downloaded data
python src\train.py

# Predict with an already-trained model
python src\predict.py AAPL

# Train all paper-inspired direction classifiers (six stocks, three horizons)
python src\train_direction.py

# Pilot one stock and horizon before running the full training matrix
python src\train_direction.py --ticker AAPL --horizon 5

# Show all trained direction horizons for one stock
python src\predict_direction.py AAPL

# Show one direction horizon
python src\predict_direction.py AAPL --horizon 5
```

## Validation strategy

For each stock, training preserves time order and reserves the newest 20% as an
unseen holdout. The older 80% is evaluated with five expanding walk-forward
folds. A one-trading-day gap separates each fold's training and validation
windows so a next-day target cannot overlap the first validation observation.

After metrics are calculated, the deployable model is refit on all labeled rows
and saved under `models/`. The model bundle retains the fold and holdout metrics.

The model inputs include the stock's 1-, 5-, and 20-day returns, recent
volatility and volume change; equivalent SPY and QQQ return/volatility features;
and the stock's five-day return relative to each benchmark.

## Paper-inspired direction model

The direction pipeline is based on the methodology in *Predicting the direction
of stock market prices using random forest* by Khaidem, Saha, and Dey. It applies
causal exponential smoothing before calculating 14-day RSI, 14-day stochastic
oscillator, 14-day Williams %R, MACD and its signal/histogram, 10-day price rate
of change, and on-balance volume. These indicators are combined with the
existing market-context features.

The original paper does not specify its smoothing factor, so this project uses
`alpha=0.2` as an explicit, reproducible default. The value and forecast
horizons are configured in `src/config.py`.

Each horizon is a binary classification task: `1` means the future adjusted
close is higher and `0` means it is unchanged or lower. Validation reports
accuracy, balanced accuracy, precision, recall, specificity, ROC-AUC, Brier
score, and a majority-class baseline. OOB score is retained only as a secondary
diagnostic because random bootstrap validation does not preserve time order.

The chronological validation gap equals the forecast horizon. For example, the
20-day classifier leaves 20 trading observations between a fold's training and
validation windows so future prices used in training labels cannot overlap the
validation period.
