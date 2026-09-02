# PaperTrade

PaperTrade is a full-stack educational stock-market simulator. It combines live
Alpaca market data, account-based paper trading, portfolio tracking, and two
experimental machine-learning forecasting pipelines in a single responsive web
application.

No real securities or money are exchanged. PaperTrade is a portfolio project,
not a broker, exchange, investment adviser, or financial service.

![PaperTrade dashboard](frontend/public/media/images/papertradedashboard.png)

## Highlights

- Search active, tradable U.S. equities exposed by the connected Alpaca account.
- Follow Alpaca IEX quotes for the six default stocks and any symbols held or
  referenced by an open order.
- Place simulated limit buy and sell orders against current bid/ask data.
- Manage paper buying power with simulated deposits and withdrawals.
- Review holdings, open positions, order history, profit and loss, and portfolio
  allocation.
- Create persistent accounts backed by MongoDB Atlas, with a local development
  store available when MongoDB is unavailable.
- Explore experimental next-day price forecasts and multi-horizon direction
  probabilities for six model-supported stocks.
- Use a responsive React interface with accessible first-visit animations.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, React Router, Vite, React Compiler, CSS |
| Backend | Node.js, Express, Mongoose |
| Database | MongoDB Atlas |
| Live market data | Alpaca Market Data API and WebSocket stream |
| Historical data | Tiingo end-of-day API |
| Machine learning | Python, pandas, NumPy, scikit-learn, joblib |

## Architecture

The production AWS architecture and deployment procedure are documented in
[`AWS_DEPLOYMENT.md`](AWS_DEPLOYMENT.md). It uses CloudFront/S3, Cognito,
API Gateway, Lambda, DynamoDB, SQS, a small Lightsail Alpaca collector, and a
scheduled prediction container. The local Express/MongoDB process remains
available for development while the AWS API entry point lives in `backend/api`.

```text
Browser
  |
  | /api through the Vite development proxy
  v
React frontend (port 5173)
  |
  v
Express API (port 3002)
  |-- MongoDB Atlas: users, balances, holdings, and orders
  |-- Alpaca REST API: asset catalog and quote snapshots
  |-- Alpaca WebSocket: live portfolio and open-order symbols
  `-- Python process: cached experimental predictions
          |
          `-- Tiingo-trained model bundles in ml/models/
```

The full Alpaca asset catalog is searched on demand rather than streamed all at
once. The live WebSocket set contains the six default symbols plus stocks that
users currently hold or have open orders for. This keeps portfolio prices and
order matching responsive without subscribing to the entire market.

## Project structure

```text
StockTradingSite/
|-- backend/                 Express API, MongoDB models, and order simulation
|-- frontend/                Active React and Vite web application
|   `-- src/dashboard/       Integrated trading dashboard
|-- ml/                      Data, features, training, and prediction utilities
|   |-- data/raw/            Ignored Tiingo downloads
|   |-- data/processed/      Ignored generated feature datasets
|   |-- models/              Ignored trained model bundles
|   |-- src/                 Python entry points and feature pipelines
|   `-- tests/               Feature-engineering unit tests
`-- README.md
```

The old top-level `dashboard/` directory is a retired standalone Create React
App implementation. It is not used by the current application and should not be
included in new builds or deployments.

## Prerequisites

- Node.js and npm
- Python 3 with `venv` and `pip`
- A MongoDB Atlas deployment
- An Alpaca paper-trading account and API credentials
- A Tiingo account and API key if you want to download data or train models

## Local setup

### 1. Install the JavaScript dependencies

```powershell
cd backend
npm install

cd ..\frontend
npm install
```

### 2. Configure the backend

Create `backend/.env`. A minimal configuration looks like this:

```dotenv
MONGODB_URI=mongodb+srv://YOUR_CONNECTION_STRING

ALPACA_API_KEY=YOUR_ALPACA_KEY
ALPACA_API_SECRET=YOUR_ALPACA_SECRET
ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets
ALPACA_DATA_FEED=iex

CLIENT_URL=http://localhost:5173
PORT=3002
```

`MONGODB_HOSTS` and `MONGODB_REPLICA_SET` are optional fallbacks for local
environments that cannot resolve MongoDB Atlas SRV records. `ML_PYTHON_PATH` can
optionally point the backend to a specific Python executable.

The frontend does not need MongoDB or Alpaca credentials. Those credentials
belong in `backend/.env` and must never be exposed through `VITE_*` variables.

### 3. Start the application

From the `frontend` directory:

```powershell
npm run dev
```

This command starts both the Express API and Vite. Open
`http://localhost:5173` in your browser.

Useful frontend commands:

```powershell
npm run lint
npm run build
npm run preview
```

## Machine-learning setup

The application supports experimental models for:

```text
AAPL, MSFT, NVDA, AMZN, GOOGL, TSLA
```

SPY and QQQ are downloaded as market-context benchmarks but do not receive
their own forecast models.

From the `ml` directory:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Create `ml/.env`:

```dotenv
TIINGO_API_KEY=YOUR_TIINGO_KEY
```

Download the historical datasets:

```powershell
python src\download_data.py
```

Train the next-day return regressors:

```powershell
python src\train.py
```

Train the Random Forest direction classifiers:

```powershell
python src\train_direction.py
```

You can pilot a single ticker and horizon before training the full matrix:

```powershell
python src\train_direction.py --ticker AAPL --horizon 5
```

Run predictions from the command line:

```powershell
python src\predict.py AAPL
python src\predict_direction.py AAPL
python src\predict_direction.py AAPL --horizon 5
```

The dashboard calls `ml/src/dashboard_predictions.py` through the backend and
caches successful prediction responses for ten minutes. Training is never
started automatically by the website.

## Model methodology

### Next-day price model

The regression pipeline estimates the next trading day's return using the
stock's lagged returns, volatility, volume changes, and its recent performance
relative to SPY and QQQ. The estimated return is translated into a next-day
price estimate for display.

### Direction model

The direction pipeline is inspired by *Predicting the direction of stock market
prices using random forest* by Khaidem, Saha, and Dey. Separate Random Forest
classifiers estimate whether the adjusted close will be higher after 1, 5, and
20 trading days.

Inputs include causal exponential smoothing, RSI, stochastic oscillator,
Williams %R, MACD, price rate of change, on-balance volume, recent returns,
volatility, volume changes, and SPY/QQQ context.

Both model families preserve chronological order during evaluation. They use an
expanding walk-forward validation scheme, an unseen recent holdout, and a gap
between training and validation that prevents future target overlap.

## Tests

Run the frontend quality checks:

```powershell
cd frontend
npm run lint
npm run build
```

Run the ML feature tests:

```powershell
cd ml
python -m unittest discover -s tests
```

## Security and repository hygiene

The root `.gitignore` excludes:

- `.env` files and credential material
- JavaScript dependencies and generated builds
- Local database state
- Python virtual environments and caches
- Downloaded market data and trained model artifacts

Only sanitized `.env.example` files should be committed. If a credential is ever
committed or pushed, revoke and rotate it immediately; deleting it in a later
commit does not remove it from Git history.

## Limitations

- Trading, balances, fills, and performance are simulated.
- Quote coverage depends on the configured Alpaca feed and subscription.
- The free IEX feed does not provide complete U.S. consolidated-market coverage.
- The current order simulator supports positive whole-share quantities and
  limit prices; it is not an exchange-grade matching engine.
- Forecasts are available only when the required local model bundles and Python
  environment exist.
- Historical validation does not guarantee future predictive performance.

## Disclaimer

All forecasts are experimental and provided for educational demonstration only.
They do not guarantee prices, returns, order outcomes, or investment results.
Nothing in this project is financial, investment, tax, or legal advice. Real
investing involves risk, including possible loss of principal.

## Author

Created by **Vedant Venkat**.

[Connect with Vedant on LinkedIn](https://www.linkedin.com/in/vedant-venkat-393b21252)
