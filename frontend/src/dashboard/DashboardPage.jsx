import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { apiRequest, clearSession } from "../api";
import { useAuth } from "../auth";
import "./dashboard.css";

const fallbackWatchlist = [
  { name: "AAPL", price: 229, percent: "+0.82%" },
  { name: "MSFT", price: 417.14, percent: "-0.31%", isDown: true },
  { name: "NVDA", price: 108.38, percent: "+1.10%" },
  { name: "AMZN", price: 178.5, percent: "+0.54%" },
  { name: "GOOGL", price: 165.86, percent: "+0.27%" },
  { name: "TSLA", price: 214.11, percent: "-0.72%", isDown: true },
];
const defaultQuoteSymbols = fallbackWatchlist.map((stock) => stock.name);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const formatUSD = (value) => usd.format(Number(value) || 0);
const formatPercent = (value, digits = 1) =>
  `${(Number(value) * 100).toFixed(digits)}%`;
const formatForecastDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Unavailable";

const navItems = [
  ["/dashboard", "Overview", true],
  ["/dashboard/orders", "Orders"],
  ["/dashboard/holdings", "Holdings"],
  ["/dashboard/positions", "Positions"],
  ["/dashboard/funds", "Funds"],
];

function useApiList(path, refreshKey = 0, pollMs = 0) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () =>
      apiRequest(path)
        .then((data) => active && setItems(data))
        .catch((requestError) => active && setError(requestError.message))
        .finally(() => active && setLoading(false));
    refresh();
    const timer = pollMs ? setInterval(refresh, pollMs) : null;
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [path, refreshKey, pollMs]);

  return { items, loading, error };
}

function useLiveWatchlist(symbols) {
  const [quoteState, setQuoteState] = useState({
    key: defaultQuoteSymbols.join(","),
    items: fallbackWatchlist,
  });
  useEffect(() => {
    let active = true;
    if (!symbols.length) {
      return () => {
        active = false;
      };
    }
    const requestedSymbols = symbols.join(",");
    const refresh = () =>
      apiRequest(`/quotes?symbols=${encodeURIComponent(requestedSymbols)}`)
        .then((quotes) => {
          if (!active) return;
          setQuoteState({
            key: requestedSymbols,
            items: quotes.map((quote) => {
              const change = quote.previousClose
                ? ((quote.price - quote.previousClose) / quote.previousClose) *
                  100
                : 0;
              return {
                name: quote.symbol,
                companyName: quote.name,
                exchange: quote.exchange,
                price: quote.price,
                bid: quote.bid,
                ask: quote.ask,
                percent: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
                isDown: change < 0,
                source: quote.source,
              };
            }),
          });
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [symbols]);
  const requestedSymbols = symbols.join(",");
  return requestedSymbols && quoteState.key === requestedSymbols
    ? quoteState.items
    : [];
}

function usePortfolioWatchlistSymbols() {
  const [symbols, setSymbols] = useState([]);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      apiRequest("/watchlist-symbols")
        .then((nextSymbols) => {
          if (!active) return;
          const normalized = [...new Set(nextSymbols)].sort();
          setSymbols((current) =>
            current.join(",") === normalized.join(",") ? current : normalized,
          );
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return symbols;
}

function StateMessage({ loading, error, empty }) {
  if (loading) return <div className="dash-state">Loading…</div>;
  if (error)
    return (
      <div className="dash-state dash-error" role="alert">
        {error}
      </div>
    );
  if (empty) return <div className="dash-state">Nothing here yet.</div>;
  return null;
}

function DataTable({ columns, rows }) {
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row._id || `${row.name}-${row.product || row.mode || "row"}`}
            >
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExperimentalForecasts() {
  const tickers = fallbackWatchlist.map((stock) => stock.name);
  const [ticker, setTicker] = useState(tickers[0]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/predictions/latest.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Forecasts are temporarily unavailable");
        return response.json();
      })
      .then((result) => {
        if (active) setForecast(result.predictions?.[ticker] || null);
      })
      .catch((requestError) => {
        if (active) {
          setForecast(null);
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ticker, refreshKey]);

  return (
    <section className="forecast-panel" aria-labelledby="forecast-title">
      <div className="forecast-heading">
        <div>
          <span className="eyebrow">Machine learning lab</span>
          <div className="forecast-title-row">
            <h2 id="forecast-title">Experimental forecasts</h2>
            <span className="experimental-badge">Experimental</span>
          </div>
        </div>
        <button
          type="button"
          className="forecast-refresh"
          onClick={() => {
            setLoading(true);
            setError("");
            setRefreshKey((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </div>

      <p className="forecast-disclaimer" role="note">
        Experimental machine-learning estimates only. They do not guarantee
        future prices or investment results and are not financial advice.
      </p>

      <div className="forecast-tickers" aria-label="Choose forecast ticker">
        {tickers.map((symbol) => (
          <button
            type="button"
            key={symbol}
            className={symbol === ticker ? "active" : ""}
            aria-pressed={symbol === ticker}
            onClick={() => {
              if (symbol !== ticker) {
                setLoading(true);
                setError("");
                setTicker(symbol);
              }
            }}
          >
            {symbol}
          </button>
        ))}
      </div>

      <StateMessage
        loading={loading}
        error={error}
        empty={!loading && !error && !forecast}
      />
      {forecast && !loading && (
        <div className="forecast-results">
          <article className="price-forecast-card">
            <span>Next-day price estimate</span>
            <strong>{formatUSD(forecast.price.impliedAdjustedClose)}</strong>
            <div
              className={
                forecast.price.predictedReturn >= 0 ? "positive" : "negative"
              }
            >
              {forecast.price.predictedReturn >= 0 ? "+" : ""}
              {formatPercent(forecast.price.predictedReturn, 3)} predicted
              return
            </div>
            <small>
              From an adjusted close of{" "}
              {formatUSD(forecast.price.latestAdjustedClose)} · Historical
              holdout direction accuracy{" "}
              {formatPercent(forecast.price.holdout.direction_accuracy)}
            </small>
          </article>

          <div className="direction-forecast-grid">
            {forecast.directions.map((direction) => (
              <article key={direction.horizonTradingDays}>
                <div className="direction-card-heading">
                  <span>{direction.horizonTradingDays}-day direction</span>
                  <b
                    className={
                      direction.predictedDirection === "RISE"
                        ? "positive"
                        : "negative"
                    }
                  >
                    {direction.predictedDirection === "RISE" ? "Rise" : "Fall"}
                  </b>
                </div>
                <strong>{formatPercent(direction.probabilityUp)}</strong>
                <small>estimated probability of a rise</small>
                <div
                  className="probability-track"
                  role="progressbar"
                  aria-label={`${direction.horizonTradingDays}-day probability of a rise`}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={(direction.probabilityUp * 100).toFixed(1)}
                >
                  <i style={{ width: `${direction.probabilityUp * 100}%` }} />
                </div>
                <small className="validation-note">
                  Historical holdout:{" "}
                  {formatPercent(direction.holdout.balanced_accuracy)} balanced
                  accuracy · AUC {Number(direction.holdout.roc_auc).toFixed(3)}
                </small>
              </article>
            ))}
          </div>

          <p className="forecast-asof">
            Based on end-of-day data through {formatForecastDate(forecast.asOf)}
            . Adjusted-price estimates may differ from live quotes.
          </p>
        </div>
      )}
    </section>
  );
}

function Overview() {
  const holdings = useApiList("/allHoldings", 0, 3000);
  const positions = useApiList("/allPositions", 0, 3000);
  const [cash, setCash] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      apiRequest("/account")
        .then((account) => active && setCash(account.cash))
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const invested = holdings.items.reduce(
    (sum, stock) => sum + Number(stock.avg) * Number(stock.qty),
    0,
  );
  const current = holdings.items.reduce(
    (sum, stock) => sum + Number(stock.price) * Number(stock.qty),
    0,
  );
  const pnl = current - invested;

  return (
    <section>
      <header className="dash-page-header">
        <div>
          <span className="eyebrow">Portfolio</span>
          <h1>Good morning</h1>
        </div>
      </header>
      <div className="metric-grid">
        <article>
          <div className="metric-label-row">
            <span>Available buying power</span>
            <NavLink to="/dashboard/funds">Manage Funds</NavLink>
          </div>
          <strong>{formatUSD(cash)}</strong>
          <small>Paper-trading balance</small>
        </article>
        <article>
          <span>Invested</span>
          <strong>{formatUSD(invested)}</strong>
          <small>{holdings.items.length} holdings</small>
        </article>
        <article>
          <span>Current value</span>
          <strong>{formatUSD(current)}</strong>
          <small className={pnl >= 0 ? "positive" : "negative"}>
            {pnl >= 0 ? "+" : ""}
            {formatUSD(pnl)} P&amp;L
          </small>
        </article>
      </div>
      <div className="portfolio-grid">
        <div className="dash-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Today</span>
              <h2>Open positions</h2>
            </div>
            <NavLink to="/dashboard/positions">View all</NavLink>
          </div>
          <StateMessage
            loading={positions.loading}
            error={positions.error}
            empty={!positions.items.length}
          />
          {!!positions.items.length && <MiniBars items={positions.items} />}
        </div>
        <div className="dash-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Holdings</span>
              <h2>Portfolio allocation</h2>
            </div>
          </div>
          <StateMessage
            loading={holdings.loading}
            error={holdings.error}
            empty={!holdings.items.length}
          />
          {!!holdings.items.length && <PortfolioPie items={holdings.items} />}
        </div>
      </div>
      <ExperimentalForecasts />
    </section>
  );
}

function MiniBars({ items }) {
  const max = Math.max(...items.map((item) => Number(item.price)), 1);
  return (
    <div className="mini-bars">
      {items.map((item) => (
        <div key={item._id || item.name}>
          <span>{item.name}</span>
          <i
            style={{
              width: `${Math.max((Number(item.price) / max) * 100, 8)}%`,
            }}
          />
          <b>{formatUSD(item.price)}</b>
        </div>
      ))}
    </div>
  );
}

function PortfolioPie({ items }) {
  const colors = [
    "#387ed1",
    "#249b64",
    "#f0a23b",
    "#9b6bd3",
    "#d84b4b",
    "#4aa6a6",
  ];
  const slices = items.map((item, index) => ({
    ...item,
    value: Number(item.price) * Number(item.qty),
    color: colors[index % colors.length],
  }));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const chartSlices = slices.reduce((result, slice) => {
    const percent = total ? (slice.value / total) * 100 : 0;
    const start = result.reduce((sum, item) => sum + item.percent, 0);
    return [...result, { ...slice, percent, start }];
  }, []);
  return (
    <div className="allocation-chart">
      <svg
        className="pie-svg"
        viewBox="0 0 42 42"
        role="img"
        aria-label="Portfolio allocation by market value"
      >
        <circle className="pie-track" cx="21" cy="21" r="15.9155" />
        {chartSlices.map((slice) => (
          <circle
            key={slice._id || slice.name}
            cx="21"
            cy="21"
            r="15.9155"
            fill="transparent"
            stroke={slice.color}
            strokeWidth="8"
            strokeDasharray={`${slice.percent} ${100 - slice.percent}`}
            strokeDashoffset={-slice.start}
          />
        ))}
        <text x="21" y="20" textAnchor="middle">
          Total
        </text>
        <text className="pie-total" x="21" y="24" textAnchor="middle">
          {formatUSD(total)}
        </text>
      </svg>
      <div className="pie-legend">
        {chartSlices.map((slice) => (
          <div key={slice._id || slice.name}>
            <i style={{ background: slice.color }} />
            <span>{slice.name}</span>
            <b>{slice.percent.toFixed(1)}%</b>
            <small>{formatUSD(slice.value)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Holdings() {
  const state = useApiList("/allHoldings", 0, 3000);
  const columns = [
    { key: "name", label: "Instrument" },
    { key: "qty", label: "Qty." },
    { key: "avg", label: "Avg. cost", render: (row) => formatUSD(row.avg) },
    {
      key: "price",
      label: "Last price",
      render: (row) => formatUSD(row.price),
    },
    {
      key: "value",
      label: "Current value",
      render: (row) => formatUSD(Number(row.price) * Number(row.qty)),
    },
    {
      key: "pnl",
      label: "P&L",
      render: (row) => {
        const value = (Number(row.price) - Number(row.avg)) * Number(row.qty);
        return (
          <span className={value >= 0 ? "positive" : "negative"}>
            {formatUSD(value)}
          </span>
        );
      },
    },
    { key: "day", label: "Day change" },
  ];
  return (
    <DashboardList title={`Holdings (${state.items.length})`} state={state}>
      <DataTable columns={columns} rows={state.items} />
    </DashboardList>
  );
}

function Positions() {
  const state = useApiList("/allPositions", 0, 3000);
  const columns = [
    { key: "product", label: "Product" },
    { key: "name", label: "Instrument" },
    { key: "qty", label: "Qty." },
    { key: "avg", label: "Average", render: (row) => formatUSD(row.avg) },
    {
      key: "price",
      label: "Last price",
      render: (row) => formatUSD(row.price),
    },
    {
      key: "pnl",
      label: "P&L",
      render: (row) => {
        const value = (Number(row.price) - Number(row.avg)) * Number(row.qty);
        return (
          <span className={value >= 0 ? "positive" : "negative"}>
            {formatUSD(value)}
          </span>
        );
      },
    },
  ];
  return (
    <DashboardList title={`Positions (${state.items.length})`} state={state}>
      <DataTable columns={columns} rows={state.items} />
    </DashboardList>
  );
}

function Orders({ refreshKey }) {
  const state = useApiList("/allOrders", refreshKey, 3000);
  const columns = [
    { key: "name", label: "Instrument" },
    { key: "qty", label: "Qty." },
    { key: "price", label: "Price", render: (row) => formatUSD(row.price) },
    {
      key: "mode",
      label: "Mode",
      render: (row) => (
        <span className={`order-mode ${String(row.mode).toLowerCase()}`}>
          {row.mode}
        </span>
      ),
    },
    { key: "status", label: "Status", render: (row) => row.status || "OPEN" },
  ];
  return (
    <DashboardList title={`Orders (${state.items.length})`} state={state}>
      <DataTable columns={columns} rows={state.items} />
    </DashboardList>
  );
}

function DashboardList({ title, state, children }) {
  return (
    <section>
      <header className="dash-page-header">
        <div>
          <span className="eyebrow">Portfolio</span>
          <h1>{title}</h1>
        </div>
      </header>
      <div className="dash-panel">
        <StateMessage
          loading={state.loading}
          error={state.error}
          empty={!state.items.length}
        />
        {!!state.items.length && children}
      </div>
    </section>
  );
}

function Funds() {
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      apiRequest("/account")
        .then((account) => active && setBalance(account.cash))
        .catch((error) => active && setMessage(error.message));
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const update = async (direction) => {
    const value = Number(amount);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (direction < 0 && value > balance)
    ) {
      setMessage("Enter a valid amount within your available balance.");
      return;
    }
    try {
      const account = await apiRequest("/funds", {
        method: "POST",
        body: JSON.stringify({
          amount: value,
          direction: direction > 0 ? "DEPOSIT" : "WITHDRAW",
        }),
      });
      setBalance(account.cash);
      setAmount("");
      setMessage(
        direction > 0
          ? "Funds added successfully."
          : "Withdrawal recorded successfully.",
      );
    } catch (error) {
      setMessage(error.message);
    }
  };
  return (
    <section>
      <header className="dash-page-header">
        <div>
          <span className="eyebrow">Account</span>
          <h1>Funds</h1>
        </div>
      </header>
      <div className="funds-card">
        <span>Available balance (USD)</span>
        <strong>{formatUSD(balance)}</strong>
        <label>
          Amount
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </label>
        <div>
          <button type="button" onClick={() => update(1)}>
            Add funds
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => update(-1)}
          >
            Withdraw
          </button>
        </div>
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}

function Watchlist({ items, onOrder, onSearchSymbolsChange }) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return undefined;

    let active = true;
    const timer = setTimeout(() => {
      apiRequest(
        `/assets?query=${encodeURIComponent(normalizedQuery)}&limit=20`,
      )
        .then((assets) => {
          if (!active) return;
          onSearchSymbolsChange(assets.map((asset) => asset.symbol));
          if (!assets.length)
            setSearchError("No additional tradable stocks found.");
        })
        .catch((error) => active && setSearchError(error.message))
        .finally(() => active && setSearching(false));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, onSearchSymbolsChange]);

  return (
    <aside className="watchlist">
      <label className="watch-search">
        <span className="visually-hidden">Search all tradable US stocks</span>
        <input
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setSearchError("");
            setSearching(Boolean(nextQuery.trim()));
            if (!nextQuery.trim()) onSearchSymbolsChange([]);
          }}
          placeholder="Search ticker or company"
        />
        <b>{searching ? "…" : items.length}</b>
      </label>
      <div className="watch-items">
        {searchError && <p className="watch-message">{searchError}</p>}
        {!searchError && !searching && items.length === 0 && (
          <p className="watch-message">No tradable stocks found.</p>
        )}
        {items.map((stock) => (
          <article key={stock.name}>
            <div>
              <strong>{stock.name}</strong>
              {stock.companyName && stock.companyName !== stock.name && (
                <span className="stock-company" title={stock.companyName}>
                  {stock.companyName}
                </span>
              )}
              <small className={stock.isDown ? "negative" : "positive"}>
                {stock.percent}
              </small>
            </div>
            <span
              title={
                stock.source === "alpaca"
                  ? "Live Alpaca IEX quote"
                  : "Fallback quote"
              }
            >
              {Number.isFinite(stock.price) ? formatUSD(stock.price) : "—"}
            </span>
            <div className="watch-actions">
              <button
                type="button"
                disabled={!Number.isFinite(stock.price)}
                onClick={() => onOrder(stock, "BUY")}
              >
                Buy
              </button>
              <button
                type="button"
                className="sell"
                disabled={!Number.isFinite(stock.price)}
                onClick={() => onOrder(stock, "SELL")}
              >
                Sell
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function OrderDialog({ draft, onClose, onPlaced }) {
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(
    draft.mode === "BUY"
      ? draft.stock.ask || draft.stock.price
      : draft.stock.bid || draft.stock.price,
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("/newOrder", {
        method: "POST",
        body: JSON.stringify({
          name: draft.stock.name,
          qty: Number(qty),
          price: Number(price),
          mode: draft.mode,
        }),
      });
      onPlaced();
    } catch (requestError) {
      setError(requestError.message);
      setSubmitting(false);
    }
  };
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="order-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-title"
      >
        <header>
          <div>
            <span className="eyebrow">{draft.mode} order</span>
            <h2 id="order-title">{draft.stock.name}</h2>
          </div>
          <button type="button" aria-label="Close order" onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <label>
            Quantity
            <input
              type="number"
              min="1"
              step="1"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              required
            />
          </label>
          <label>
            Limit price (USD)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
            />
          </label>
          <p>
            Estimated value{" "}
            <strong>{formatUSD(Number(qty || 0) * Number(price || 0))}</strong>
          </p>
          {error && (
            <div className="dash-error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={submitting}>
              {submitting
                ? "Placing…"
                : `Place ${draft.mode.toLowerCase()} order`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const portfolioSymbols = usePortfolioWatchlistSymbols();
  const [searchSymbols, setSearchSymbols] = useState([]);
  const quoteSymbols = useMemo(
    () => [
      ...new Set([
        ...defaultQuoteSymbols,
        ...portfolioSymbols,
        ...searchSymbols,
      ]),
    ],
    [portfolioSymbols, searchSymbols],
  );
  const watchlist = useLiveWatchlist(quoteSymbols);
  const [draft, setDraft] = useState(null);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const user = auth.user || {
    name: "Demo User",
    email: "demo@papertrade.local",
  };
  const logout = async () => {
    await auth.signOut();
    clearSession();
    navigate("/signup");
  };
  return (
    <div className="trading-dashboard">
      <header className="dash-topbar">
        <NavLink to="/" className="dash-logo">
          <span>P</span> PaperTrade
        </NavLink>
        <nav>
          {navItems.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="dash-profile">
          <span>{user.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <div className="dash-body">
        <Watchlist
          items={watchlist}
          onSearchSymbolsChange={setSearchSymbols}
          onOrder={(stock, mode) => setDraft({ stock, mode })}
        />
        <main className="dash-content">
          <Routes>
            <Route index element={<Overview />} />
            <Route
              path="orders"
              element={<Orders refreshKey={ordersVersion} />}
            />
            <Route path="holdings" element={<Holdings />} />
            <Route path="positions" element={<Positions />} />
            <Route path="funds" element={<Funds />} />
          </Routes>
        </main>
      </div>
      {draft && (
        <OrderDialog
          draft={draft}
          onClose={() => setDraft(null)}
          onPlaced={() => {
            setDraft(null);
            setOrdersVersion((value) => value + 1);
            navigate("/dashboard/orders");
          }}
        />
      )}
    </div>
  );
}
