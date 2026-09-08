const storageKey = "papertrade-demo-portfolio";
const startingCash = 10000;

function initialState() {
  return { cash: startingCash, holdings: [], orders: [] };
}

function readState() {
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return initialState();
    const state = JSON.parse(saved);
    if (
      !Number.isFinite(state.cash) ||
      !Array.isArray(state.holdings) ||
      !Array.isArray(state.orders)
    ) {
      return initialState();
    }
    return state;
  } catch {
    return initialState();
  }
}

function writeState(state) {
  sessionStorage.setItem(storageKey, JSON.stringify(state));
  return state;
}

function responseError(message) {
  throw new Error(message);
}

function placeOrder(options) {
  const body = JSON.parse(options.body || "{}");
  const name = String(body.name || "").trim().toUpperCase();
  const qty = Number(body.qty);
  const price = Number(body.price);
  const mode = String(body.mode || "").toUpperCase();

  if (
    !/^[A-Z.]{1,10}$/.test(name) ||
    !Number.isInteger(qty) ||
    qty <= 0 ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !["BUY", "SELL"].includes(mode)
  ) {
    return responseError(
      "A valid symbol, whole-share quantity, price, and side are required",
    );
  }

  const state = readState();
  const holdingIndex = state.holdings.findIndex((item) => item.name === name);
  const holding = state.holdings[holdingIndex];
  const value = Number((qty * price).toFixed(2));

  if (mode === "BUY" && value > state.cash) {
    return responseError("This demo order exceeds your available buying power");
  }
  if (mode === "SELL" && (!holding || holding.qty < qty)) {
    return responseError(`You do not own ${qty} shares of ${name}`);
  }

  if (mode === "BUY") {
    const previousQty = Number(holding?.qty || 0);
    const nextQty = previousQty + qty;
    const avg = Number(
      (((Number(holding?.avg || 0) * previousQty) + value) / nextQty).toFixed(
        2,
      ),
    );
    const nextHolding = {
      _id: `DEMO-HOLDING-${name}`,
      name,
      qty: nextQty,
      avg,
      price,
      day: holding?.day || "+0.00%",
    };
    if (holdingIndex >= 0) state.holdings[holdingIndex] = nextHolding;
    else state.holdings.push(nextHolding);
    state.cash = Number((state.cash - value).toFixed(2));
  } else {
    const nextQty = holding.qty - qty;
    if (nextQty === 0) state.holdings.splice(holdingIndex, 1);
    else state.holdings[holdingIndex] = { ...holding, qty: nextQty, price };
    state.cash = Number((state.cash + value).toFixed(2));
  }

  const createdAt = new Date().toISOString();
  const order = {
    _id: `demo-order-${crypto.randomUUID()}`,
    name,
    qty,
    price,
    mode,
    status: "FILLED",
    fillPrice: price,
    filledAt: createdAt,
    createdAt,
  };
  state.orders.unshift(order);
  writeState(state);
  return { order, cash: state.cash };
}

export async function demoPortfolioRequest(path, options = {}) {
  const state = readState();
  if (path === "/account") return { cash: state.cash };
  if (path === "/allHoldings") return state.holdings;
  if (path === "/allPositions") {
    return state.holdings.map((holding) => ({ ...holding, product: "CASH" }));
  }
  if (path === "/allOrders") return state.orders;
  if (path === "/watchlist-symbols") {
    return [...new Set(state.holdings.map((holding) => holding.name))].sort();
  }
  if (path === "/funds" && options.method === "POST") {
    const body = JSON.parse(options.body || "{}");
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return responseError("Enter a valid amount");
    }
    if (body.direction === "WITHDRAW" && amount > state.cash) {
      return responseError("Insufficient cash balance");
    }
    state.cash = Number(
      (state.cash + (body.direction === "WITHDRAW" ? -amount : amount)).toFixed(
        2,
      ),
    );
    writeState(state);
    return { cash: state.cash };
  }
  if (path === "/newOrder" && options.method === "POST") {
    return placeOrder(options);
  }
  return responseError("Demo request is not supported");
}

export function clearDemoSession() {
  sessionStorage.removeItem(storageKey);
}
