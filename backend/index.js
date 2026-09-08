const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, ".env") });
// The frontend env file is also loaded by the Node process for local development.
// Vite only exposes VITE_* variables, so this server-only value is not bundled.
require("dotenv").config({ path: path.join(__dirname, "../frontend/.env") });

const express = require("express");
const mongoose = require("mongoose");
const dns = require("node:dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);
const cors = require("cors");

const { HoldingsModel } = require("./model/HoldingsModel");

const { OrdersModel } = require("./model/OrdersModel");
const { UsersModel } = require("./model/UsersModel");
const { createPredictionService } = require("./predictions");

const PORT = process.env.PORT || 3002;
const configuredMongoTimeout = Number(process.env.MONGO_STARTUP_TIMEOUT_MS);
const mongoStartupTimeoutMs =
  Number.isFinite(configuredMongoTimeout) && configuredMongoTimeout > 0
    ? configuredMongoTimeout
    : 5000;
const uri = [
  process.env.MONGO_URL,
  process.env.ATLASDB_URL,
  process.env.MONGODB_URI,
]
  .map((value) => String(value || "").trim())
  .find((value) => /^mongodb(?:\+srv)?:\/\//.test(value));

function mongoConnectionUri(srvUri) {
  const hosts = String(process.env.MONGODB_HOSTS || "").trim();
  if (!srvUri?.startsWith("mongodb+srv://") || !hosts) return srvUri;

  const parsed = new URL(srvUri.replace(/^mongodb\+srv:/, "https:"));
  const credentials = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
    : "";
  const options = new URLSearchParams(parsed.search);
  options.set("tls", "true");
  options.set("authSource", options.get("authSource") || "admin");

  const replicaSet = String(process.env.MONGODB_REPLICA_SET || "").trim();
  if (replicaSet) options.set("replicaSet", replicaSet);

  const databasePath =
    parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/";
  return `mongodb://${credentials}${hosts}${databasePath}?${options.toString()}`;
}

const app = express();
let databaseConnected = false;
const fallbackPrices = Object.freeze({
  AAPL: 229,
  MSFT: 417.14,
  NVDA: 108.38,
  AMZN: 178.5,
  GOOGL: 165.86,
  TSLA: 214.11,
});
const predictionSymbols = Object.keys(fallbackPrices);
const defaultQuoteSymbols = [...predictionSymbols];
const predictionService = createPredictionService();
const alpacaApiKey = process.env.ALPACA_API_KEY;
const alpacaApiSecret = process.env.ALPACA_API_SECRET;
const alpacaDataBaseUrl = String(
  process.env.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets",
).replace(/\/$/, "");
const alpacaDataFeed = process.env.ALPACA_DATA_FEED || "iex";
const alpacaTradingBaseUrl = String(
  process.env.ALPACA_TRADING_BASE_URL || "https://paper-api.alpaca.markets",
).replace(/\/$/, "");
const marketQuotes = new Map(
  defaultQuoteSymbols.map((symbol) => [
    symbol,
    {
      symbol,
      price: fallbackPrices[symbol],
      source: "fallback",
      updatedAt: null,
    },
  ]),
);
let alpacaAssets = new Map(
  defaultQuoteSymbols.map((symbol) => [
    symbol,
    {
      symbol,
      name: symbol,
      exchange: "US",
      tradable: true,
      fractionable: false,
      shortable: false,
    },
  ]),
);
const marketDataState = {
  enabled: Boolean(alpacaApiKey && alpacaApiSecret),
  status: alpacaApiKey && alpacaApiSecret ? "connecting" : "disabled",
  feed: alpacaDataFeed,
  lastMessageAt: null,
  assetsLoaded: false,
  assetCount: alpacaAssets.size,
  streamedSymbolCount: defaultQuoteSymbols.length,
};
let alpacaSocket;
let reconnectTimer;
let snapshotRefreshTimer;
let streamRefreshTimer;
let reconnectDelay = 1000;
const desiredStreamSymbols = new Set(defaultQuoteSymbols);
let matchingQueue = Promise.resolve();
const matchingTimers = new Map();
const storePath = path.join(__dirname, "data", "dev-store.json");
const defaultStore = {
  schemaVersion: 3,
  holdings: [],
  positions: [],
  orders: [],
  users: [],
};

function loadLocalStore() {
  try {
    const stored = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const portfolio =
      stored.schemaVersion === defaultStore.schemaVersion
        ? stored
        : defaultStore;
    const users = Array.isArray(stored.users)
      ? stored.users.map((user) => ({
          ...user,
          cash: Number.isFinite(user.cash) ? user.cash : 10000,
        }))
      : [];
    return {
      schemaVersion: defaultStore.schemaVersion,
      holdings: Array.isArray(portfolio.holdings)
        ? portfolio.holdings
        : defaultStore.holdings,
      positions: Array.isArray(portfolio.positions)
        ? portfolio.positions
        : defaultStore.positions,
      orders:
        stored.schemaVersion === defaultStore.schemaVersion &&
        Array.isArray(stored.orders)
          ? stored.orders
          : [],
      users,
    };
  } catch {
    return JSON.parse(JSON.stringify(defaultStore));
  }
}

const localStore = loadLocalStore();
const memoryHoldings = localStore.holdings;
const memoryOrders = localStore.orders;
const memoryUsers = localStore.users;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function persistLocalStore() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(localStore, null, 2));
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}

function createSession(user) {
  const payload = Buffer.from(
    JSON.stringify({
      userId: String(user._id),
      expiresAt: Date.now() + SESSION_LIFETIME_MS,
    }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", String(user.passwordHash))
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

async function requireAuth(req, res, next) {
  try {
    const token = String(req.headers.authorization || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error("Malformed session");

    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !session.userId ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now()
    ) {
      throw new Error("Expired session");
    }

    const user = databaseConnected
      ? await UsersModel.findById(session.userId)
      : findLocalUser(session.userId);
    if (!user) throw new Error("Account not found");

    const expected = crypto
      .createHmac("sha256", String(user.passwordHash))
      .update(payload)
      .digest();
    const received = Buffer.from(signature, "base64url");
    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      throw new Error("Invalid session signature");
    }

    req.user = publicUser(user);
    return next();
  } catch {
    return res
      .status(401)
      .json({ error: "Your session expired. Sign in again to continue." });
  }
}

function findLocalUser(userId) {
  return memoryUsers.find((user) => String(user._id) === String(userId));
}

function getMarketQuote(symbol) {
  return marketQuotes.get(symbol) || null;
}

function updateMarketQuote(symbol, values) {
  const previous = marketQuotes.get(symbol) || {
    symbol,
    price: null,
    source: "unavailable",
    updatedAt: null,
  };
  const next = {
    ...previous,
    ...Object.fromEntries(
      Object.entries(values).filter(([, value]) => Number.isFinite(value)),
    ),
    symbol,
    source: "alpaca",
    updatedAt: new Date().toISOString(),
  };
  marketQuotes.set(symbol, next);
  marketDataState.lastMessageAt = next.updatedAt;
  scheduleOrderMatching(symbol);
}

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": alpacaApiKey,
    "APCA-API-SECRET-KEY": alpacaApiSecret,
  };
}

async function fetchAlpacaAssets() {
  if (!marketDataState.enabled) return;
  const url = new URL(`${alpacaTradingBaseUrl}/v2/assets`);
  url.searchParams.set("status", "active");
  url.searchParams.set("asset_class", "us_equity");
  const response = await fetch(url, { headers: alpacaHeaders() });
  if (!response.ok)
    throw new Error(`asset request returned ${response.status}`);

  const payload = await response.json();
  const assets = new Map(
    payload
      .filter(
        (asset) =>
          asset.status === "active" &&
          asset.tradable === true &&
          asset.class === "us_equity" &&
          asset.exchange !== "OTC",
      )
      .map((asset) => [
        asset.symbol,
        {
          symbol: asset.symbol,
          name: asset.name,
          exchange: asset.exchange,
          tradable: asset.tradable,
          fractionable: asset.fractionable,
          shortable: asset.shortable,
        },
      ]),
  );
  if (!assets.size) throw new Error("asset request returned no tradable stocks");
  alpacaAssets = assets;
  marketDataState.assetsLoaded = true;
  marketDataState.assetCount = assets.size;
}

function executionPriceFor(mode, quote) {
  if (!quote) return null;
  if (mode === "BUY" && Number.isFinite(quote.ask) && quote.ask > 0)
    return quote.ask;
  if (mode === "SELL" && Number.isFinite(quote.bid) && quote.bid > 0)
    return quote.bid;
  return Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
}

function isMarketable(mode, limitPrice, executionPrice) {
  return mode === "BUY"
    ? limitPrice >= executionPrice
    : limitPrice <= executionPrice;
}

async function fetchAlpacaSnapshots(symbols = defaultQuoteSymbols) {
  if (!marketDataState.enabled || !symbols.length) return;
  for (let index = 0; index < symbols.length; index += 50) {
    const batch = symbols.slice(index, index + 50);
    const url = new URL(`${alpacaDataBaseUrl}/v2/stocks/snapshots`);
    url.searchParams.set("symbols", batch.join(","));
    url.searchParams.set("feed", alpacaDataFeed);
    const response = await fetch(url, { headers: alpacaHeaders() });
    if (!response.ok)
      throw new Error(`snapshot request returned ${response.status}`);
    const payload = await response.json();
    const snapshots = payload.snapshots || payload;
    for (const symbol of batch) {
      const snapshot = snapshots[symbol];
      if (!snapshot) continue;
      updateMarketQuote(symbol, {
        price:
          snapshot.latestTrade?.p ??
          snapshot.minuteBar?.c ??
          snapshot.dailyBar?.c,
        bid: snapshot.latestQuote?.bp,
        ask: snapshot.latestQuote?.ap,
        previousClose: snapshot.prevDailyBar?.c,
      });
    }
  }
}

function sendStreamAction(action, symbols) {
  if (
    !symbols.length ||
    !alpacaSocket ||
    alpacaSocket.readyState !== WebSocket.OPEN ||
    marketDataState.status !== "connected"
  ) {
    return;
  }
  alpacaSocket.send(
    JSON.stringify({
      action,
      trades: symbols,
      quotes: symbols,
      bars: symbols,
    }),
  );
}

function setDesiredStreamSymbols(symbols) {
  const nextSymbols = new Set([
    ...defaultQuoteSymbols,
    ...symbols.filter((symbol) => alpacaAssets.has(symbol)),
  ]);
  const added = [...nextSymbols].filter(
    (symbol) => !desiredStreamSymbols.has(symbol),
  );
  const removed = [...desiredStreamSymbols].filter(
    (symbol) => !nextSymbols.has(symbol),
  );
  desiredStreamSymbols.clear();
  for (const symbol of nextSymbols) desiredStreamSymbols.add(symbol);
  marketDataState.streamedSymbolCount = desiredStreamSymbols.size;
  sendStreamAction("unsubscribe", removed);
  sendStreamAction("subscribe", added);
}

function addDesiredStreamSymbol(symbol) {
  if (!alpacaAssets.has(symbol) || desiredStreamSymbols.has(symbol)) return;
  desiredStreamSymbols.add(symbol);
  marketDataState.streamedSymbolCount = desiredStreamSymbols.size;
  sendStreamAction("subscribe", [symbol]);
}

async function refreshPortfolioStreamSubscriptions() {
  const [holdingSymbols, openOrderSymbols] = databaseConnected
    ? await Promise.all([
        HoldingsModel.distinct("name"),
        OrdersModel.distinct("name", { status: "OPEN" }),
      ])
    : [
        memoryHoldings.map((holding) => holding.name),
        memoryOrders
          .filter((order) => order.status === "OPEN")
          .map((order) => order.name),
      ];
  setDesiredStreamSymbols([...holdingSymbols, ...openOrderSymbols]);
}

function scheduleReconnect() {
  if (reconnectTimer || !marketDataState.enabled) return;
  marketDataState.status = "reconnecting";
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectAlpacaStream();
  }, reconnectDelay);
  reconnectTimer.unref?.();
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function connectAlpacaStream() {
  if (!marketDataState.enabled) return;
  marketDataState.status = "connecting";
  const socket = new WebSocket(
    `wss://stream.data.alpaca.markets/v2/${alpacaDataFeed}`,
  );
  alpacaSocket = socket;

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        action: "auth",
        key: alpacaApiKey,
        secret: alpacaApiSecret,
      }),
    );
  });
  socket.addEventListener("message", (event) => {
    let messages;
    try {
      messages = JSON.parse(String(event.data));
    } catch {
      return;
    }
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      if (message.T === "success" && message.msg === "authenticated") {
        marketDataState.status = "connected";
        reconnectDelay = 1000;
        socket.send(
          JSON.stringify({
            action: "subscribe",
            trades: [...desiredStreamSymbols],
            quotes: [...desiredStreamSymbols],
            bars: [...desiredStreamSymbols],
          }),
        );
      } else if (message.T === "t") {
        updateMarketQuote(message.S, { price: message.p });
      } else if (message.T === "q") {
        updateMarketQuote(message.S, { bid: message.bp, ask: message.ap });
      } else if (message.T === "b") {
        updateMarketQuote(message.S, { price: message.c });
      } else if (message.T === "error") {
        marketDataState.status = "error";
        console.warn(
          `Alpaca market-data stream error ${message.code || "unknown"}: ${message.msg || "request failed"}`,
        );
      }
    }
  });
  socket.addEventListener("error", () => {
    marketDataState.status = "error";
  });
  socket.addEventListener("close", () => {
    if (alpacaSocket === socket) alpacaSocket = null;
    scheduleReconnect();
  });
}

async function startAlpacaMarketData() {
  if (!marketDataState.enabled) {
    console.warn(
      "Alpaca market data is disabled because API credentials are missing",
    );
    return;
  }
  try {
    await fetchAlpacaAssets();
    console.log(
      `Loaded ${marketDataState.assetCount} active Alpaca-tradable US equities`,
    );
  } catch (error) {
    console.warn(`Alpaca asset catalog unavailable: ${error.message}`);
  }
  try {
    await refreshPortfolioStreamSubscriptions();
  } catch (error) {
    console.warn(`Unable to load portfolio stream symbols: ${error.message}`);
  }
  try {
    await fetchAlpacaSnapshots([...desiredStreamSymbols]);
    console.log(`Alpaca ${alpacaDataFeed.toUpperCase()} snapshot loaded`);
  } catch (error) {
    console.warn(`Alpaca snapshot unavailable: ${error.message}`);
  }
  connectAlpacaStream();
  snapshotRefreshTimer = setInterval(() => {
    fetchAlpacaSnapshots([...desiredStreamSymbols]).catch((error) => {
      console.warn(`Alpaca snapshot refresh failed: ${error.message}`);
    });
  }, 60000);
  snapshotRefreshTimer.unref?.();
  streamRefreshTimer = setInterval(() => {
    refreshPortfolioStreamSubscriptions().catch((error) => {
      console.warn(`Portfolio stream refresh failed: ${error.message}`);
    });
  }, 30000);
  streamRefreshTimer.unref?.();
}

app.use(
  cors({
    origin: process.env.CLIENT_URL
      ? process.env.CLIENT_URL.split(",").map((origin) => origin.trim())
      : true,
  }),
);
app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    database: databaseConnected,
    storage: databaseConnected ? "mongodb" : "local-file",
    marketData: { ...marketDataState },
  });
});

app.post("/signup", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (
      name.length < 2 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          "Enter a name, valid email, and password of at least 8 characters",
      });
    }

    const existingUser = databaseConnected
      ? await UsersModel.findOne({ email })
      : memoryUsers.find((user) => user.email === email);
    if (existingUser) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const userData = {
      name,
      email,
      salt,
      passwordHash: hashPassword(password, salt),
      cash: 10000,
    };
    const user = databaseConnected
      ? await UsersModel.create(userData)
      : { _id: `user-${Date.now()}`, ...userData };
    if (!databaseConnected) {
      memoryUsers.push(user);
      persistLocalStore();
    }

    return res
      .status(201)
      .json({ user: publicUser(user), token: createSession(user) });
  } catch (error) {
    return res.status(500).json({ error: "Unable to create account" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const user = databaseConnected
      ? await UsersModel.findOne({ email })
      : memoryUsers.find((candidate) => candidate.email === email);

    if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    return res.json({ user: publicUser(user), token: createSession(user) });
  } catch (error) {
    return res.status(500).json({ error: "Unable to sign in" });
  }
});

app.get("/me", requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

// app.get("/addHoldings", async (req, res) => {
//   let tempHoldings = [
//     {
//       name: "BHARTIARTL",
//       qty: 2,
//       avg: 538.05,
//       price: 541.15,
//       net: "+0.58%",
//       day: "+2.99%",
//     },
//     {
//       name: "HDFCBANK",
//       qty: 2,
//       avg: 1383.4,
//       price: 1522.35,
//       net: "+10.04%",
//       day: "+0.11%",
//     },
//     {
//       name: "HINDUNILVR",
//       qty: 1,
//       avg: 2335.85,
//       price: 2417.4,
//       net: "+3.49%",
//       day: "+0.21%",
//     },
//     {
//       name: "INFY",
//       qty: 1,
//       avg: 1350.5,
//       price: 1555.45,
//       net: "+15.18%",
//       day: "-1.60%",
//       isLoss: true,
//     },
//     {
//       name: "ITC",
//       qty: 5,
//       avg: 202.0,
//       price: 207.9,
//       net: "+2.92%",
//       day: "+0.80%",
//     },
//     {
//       name: "KPITTECH",
//       qty: 5,
//       avg: 250.3,
//       price: 266.45,
//       net: "+6.45%",
//       day: "+3.54%",
//     },
//     {
//       name: "M&M",
//       qty: 2,
//       avg: 809.9,
//       price: 779.8,
//       net: "-3.72%",
//       day: "-0.01%",
//       isLoss: true,
//     },
//     {
//       name: "RELIANCE",
//       qty: 1,
//       avg: 2193.7,
//       price: 2112.4,
//       net: "-3.71%",
//       day: "+1.44%",
//     },
//     {
//       name: "SBIN",
//       qty: 4,
//       avg: 324.35,
//       price: 430.2,
//       net: "+32.63%",
//       day: "-0.34%",
//       isLoss: true,
//     },
//     {
//       name: "SGBMAY29",
//       qty: 2,
//       avg: 4727.0,
//       price: 4719.0,
//       net: "-0.17%",
//       day: "+0.15%",
//     },
//     {
//       name: "TATAPOWER",
//       qty: 5,
//       avg: 104.2,
//       price: 124.15,
//       net: "+19.15%",
//       day: "-0.24%",
//       isLoss: true,
//     },
//     {
//       name: "TCS",
//       qty: 1,
//       avg: 3041.7,
//       price: 3194.8,
//       net: "+5.03%",
//       day: "-0.25%",
//       isLoss: true,
//     },
//     {
//       name: "WIPRO",
//       qty: 4,
//       avg: 489.3,
//       price: 577.75,
//       net: "+18.08%",
//       day: "+0.32%",
//     },
//   ];

//   tempHoldings.forEach((item) => {
//     let newHolding = new HoldingsModel({
//       name: item.name,
//       qty: item.qty,
//       avg: item.avg,
//       price: item.price,
//       net: item.day,
//       day: item.day,
//     });

//     newHolding.save();
//   });
//   res.send("Done!");
// });

// app.get("/addPositions", async (req, res) => {
//   let tempPositions = [
//     {
//       product: "CNC",
//       name: "EVEREADY",
//       qty: 2,
//       avg: 316.27,
//       price: 312.35,
//       net: "+0.58%",
//       day: "-1.24%",
//       isLoss: true,
//     },
//     {
//       product: "CNC",
//       name: "JUBLFOOD",
//       qty: 1,
//       avg: 3124.75,
//       price: 3082.65,
//       net: "+10.04%",
//       day: "-1.35%",
//       isLoss: true,
//     },
//   ];

//   tempPositions.forEach((item) => {
//     let newPosition = new PositionsModel({
//       product: item.product,
//       name: item.name,
//       qty: item.qty,
//       avg: item.avg,
//       price: item.price,
//       net: item.net,
//       day: item.day,
//       isLoss: item.isLoss,
//     });

//     newPosition.save();
//   });
//   res.send("Done!");
// });

function withCurrentPrice(holding) {
  const item = holding.toObject ? holding.toObject() : holding;
  const quote = getMarketQuote(item.name);
  const price = quote?.price ?? item.price;
  const netValue = item.avg ? ((price - item.avg) / item.avg) * 100 : 0;
  const previousClose = quote?.previousClose;
  const dayValue = previousClose
    ? ((price - previousClose) / previousClose) * 100
    : null;
  return {
    ...item,
    price,
    net: `${netValue >= 0 ? "+" : ""}${netValue.toFixed(2)}%`,
    day:
      dayValue === null
        ? item.day
        : `${dayValue >= 0 ? "+" : ""}${dayValue.toFixed(2)}%`,
  };
}

function quoteResponse(symbol) {
  const quote = getMarketQuote(symbol) || {
    symbol,
    price: null,
    source: "unavailable",
    updatedAt: null,
  };
  return { ...alpacaAssets.get(symbol), ...quote };
}

function requestedQuoteSymbols(value) {
  if (!value) return defaultQuoteSymbols;
  return [
    ...new Set(
      String(value)
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, 25);
}

async function refreshRequestedQuotes(symbols) {
  const staleSymbols = symbols.filter((symbol) => {
    const updatedAt = Date.parse(getMarketQuote(symbol)?.updatedAt || "");
    return !Number.isFinite(updatedAt) || Date.now() - updatedAt > 15000;
  });
  if (staleSymbols.length) await fetchAlpacaSnapshots(staleSymbols);
}

async function getUserHolding(userId, name) {
  return databaseConnected
    ? HoldingsModel.findOne({ userId, name })
    : memoryHoldings.find(
        (holding) => holding.userId === userId && holding.name === name,
      );
}

app.get("/assets", (req, res) => {
  const query = String(req.query.query || "")
    .trim()
    .toUpperCase();
  const requestedLimit = Number(req.query.limit);
  const limit = Math.min(
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? requestedLimit
      : 20,
    50,
  );
  if (!query) return res.json([]);

  const results = [...alpacaAssets.values()]
    .filter(
      (asset) =>
        asset.symbol.includes(query) || asset.name.toUpperCase().includes(query),
    )
    .sort((left, right) => {
      const leftRank = left.symbol === query ? 0 : left.symbol.startsWith(query) ? 1 : 2;
      const rightRank = right.symbol === query ? 0 : right.symbol.startsWith(query) ? 1 : 2;
      return leftRank - rightRank || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, limit);
  return res.json(results);
});

app.get("/quotes", async (req, res) => {
  const symbols = requestedQuoteSymbols(req.query.symbols);
  const unsupported = symbols.filter((symbol) => !alpacaAssets.has(symbol));
  if (unsupported.length) {
    return res.status(400).json({
      error: `Unsupported or non-tradable symbol: ${unsupported.join(", ")}`,
    });
  }

  try {
    await refreshRequestedQuotes(symbols);
  } catch (error) {
    console.warn(`Requested Alpaca quotes unavailable: ${error.message}`);
  }
  return res.json(symbols.map(quoteResponse));
});

app.get("/predictions/:symbol", requireAuth, async (req, res) => {
  const symbol = String(req.params.symbol || "")
    .trim()
    .toUpperCase();
  if (!predictionSymbols.includes(symbol)) {
    return res.status(400).json({ error: "Unsupported prediction symbol" });
  }

  try {
    return res.json(await predictionService.getPrediction(symbol));
  } catch (error) {
    console.warn(
      `Experimental prediction failed for ${symbol}: ${error.message}`,
    );
    return res.status(503).json({
      error: "Experimental forecasts are temporarily unavailable",
    });
  }
});

app.get("/account", requireAuth, async (req, res) => {
  try {
    const user = databaseConnected
      ? await UsersModel.findById(req.user.id)
      : findLocalUser(req.user.id);
    if (!user) return res.status(404).json({ error: "Account not found" });
    return res.json({ cash: Number.isFinite(user.cash) ? user.cash : 10000 });
  } catch {
    return res.status(500).json({ error: "Unable to load account" });
  }
});

app.post("/funds", requireAuth, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const direction = req.body.direction === "WITHDRAW" ? -1 : 1;
    if (!Number.isFinite(amount) || amount <= 0)
      return res.status(400).json({ error: "Enter a valid amount" });
    const user = databaseConnected
      ? await UsersModel.findById(req.user.id)
      : findLocalUser(req.user.id);
    if (!user) return res.status(404).json({ error: "Account not found" });
    const currentCash = Number.isFinite(user.cash) ? user.cash : 10000;
    if (direction < 0 && amount > currentCash)
      return res.status(400).json({ error: "Insufficient cash balance" });
    user.cash = currentCash + direction * amount;
    if (databaseConnected) await user.save();
    else persistLocalStore();
    return res.json({ cash: user.cash });
  } catch {
    return res.status(500).json({ error: "Unable to update account balance" });
  }
});

app.get("/allHoldings", requireAuth, async (req, res) => {
  try {
    const allHoldings = databaseConnected
      ? await HoldingsModel.find({ userId: req.user.id })
      : memoryHoldings.filter((holding) => holding.userId === req.user.id);
    res.json(allHoldings.map(withCurrentPrice));
  } catch (error) {
    res.status(500).json({ error: "Unable to load holdings" });
  }
});

app.get("/allPositions", requireAuth, async (req, res) => {
  try {
    const holdings = databaseConnected
      ? await HoldingsModel.find({ userId: req.user.id })
      : memoryHoldings.filter((holding) => holding.userId === req.user.id);
    res.json(
      holdings
        .map(withCurrentPrice)
        .map((holding) => ({ ...holding, product: "CASH" })),
    );
  } catch (error) {
    res.status(500).json({ error: "Unable to load positions" });
  }
});

app.get("/allOrders", requireAuth, async (req, res) => {
  try {
    const allOrders = databaseConnected
      ? await OrdersModel.find({ userId: req.user.id }).sort({ createdAt: -1 })
      : memoryOrders.filter((order) => order.userId === req.user.id);
    res.json(allOrders);
  } catch (error) {
    res.status(500).json({ error: "Unable to load orders" });
  }
});

app.get("/watchlist-symbols", requireAuth, async (req, res) => {
  try {
    const [holdingSymbols, openOrderSymbols] = databaseConnected
      ? await Promise.all([
          HoldingsModel.distinct("name", { userId: req.user.id }),
          OrdersModel.distinct("name", {
            userId: req.user.id,
            status: "OPEN",
          }),
        ])
      : [
          memoryHoldings
            .filter(
              (holding) => String(holding.userId) === String(req.user.id),
            )
            .map((holding) => holding.name),
          memoryOrders
            .filter(
              (order) =>
                String(order.userId) === String(req.user.id) &&
                order.status === "OPEN",
            )
            .map((order) => order.name),
        ];
    return res.json([
      ...new Set(
        [...holdingSymbols, ...openOrderSymbols]
          .map((symbol) => String(symbol).toUpperCase())
          .filter((symbol) => alpacaAssets.has(symbol)),
      ),
    ]);
  } catch (error) {
    return res.status(500).json({ error: "Unable to load watchlist symbols" });
  }
});

async function saveOrder(order) {
  if (databaseConnected) await order.save();
  else persistLocalStore();
}

async function rejectOrder(order, reason) {
  order.status = "REJECTED";
  order.rejectionReason = reason;
  await saveOrder(order);
  refreshPortfolioStreamSubscriptions().catch(() => {});
}

async function fillOrder(order, fillPrice) {
  if (order.status !== "OPEN") return order;
  const userId = String(order.userId);
  const holding = await getUserHolding(userId, order.name);
  const user = databaseConnected
    ? await UsersModel.findById(userId)
    : findLocalUser(userId);
  if (!user) {
    await rejectOrder(order, "Account not found");
    return order;
  }

  const cash = Number.isFinite(user.cash) ? user.cash : 10000;
  const cost = fillPrice * order.qty;
  if (order.mode === "BUY" && cost > cash) {
    await rejectOrder(order, "Insufficient cash balance at fill time");
    return order;
  }
  if (order.mode === "SELL" && (!holding || holding.qty < order.qty)) {
    await rejectOrder(order, "Insufficient shares at fill time");
    return order;
  }

  if (order.mode === "BUY") {
    const previousQty = holding ? holding.qty : 0;
    const nextQty = previousQty + order.qty;
    const nextAvg =
      ((holding ? holding.avg * previousQty : 0) + cost) / nextQty;
    if (databaseConnected) {
      await HoldingsModel.findOneAndUpdate(
        { userId, name: order.name },
        {
          $set: {
            qty: nextQty,
            avg: nextAvg,
            price: fillPrice,
            day: "0.00%",
            isLoss: false,
          },
        },
        { upsert: true, new: true },
      );
    } else if (holding) {
      Object.assign(holding, { qty: nextQty, avg: nextAvg, price: fillPrice });
    } else {
      memoryHoldings.push({
        _id: `holding-${Date.now()}-${crypto.randomUUID()}`,
        userId,
        name: order.name,
        qty: order.qty,
        avg: fillPrice,
        price: fillPrice,
        day: "0.00%",
      });
    }
    user.cash = cash - cost;
  } else {
    const nextQty = holding.qty - order.qty;
    if (databaseConnected) {
      if (nextQty === 0) await HoldingsModel.deleteOne({ _id: holding._id });
      else {
        holding.qty = nextQty;
        holding.price = fillPrice;
        await holding.save();
      }
    } else if (nextQty === 0) {
      memoryHoldings.splice(memoryHoldings.indexOf(holding), 1);
    } else {
      holding.qty = nextQty;
      holding.price = fillPrice;
    }
    user.cash = cash + cost;
  }

  order.status = "FILLED";
  order.fillPrice = fillPrice;
  order.filledAt = new Date();
  if (databaseConnected) await user.save();
  await saveOrder(order);
  refreshPortfolioStreamSubscriptions().catch((error) => {
    console.warn(`Unable to refresh portfolio streams: ${error.message}`);
  });
  return order;
}

async function matchOpenOrders(symbol) {
  const quote = getMarketQuote(symbol);
  const orders = databaseConnected
    ? await OrdersModel.find({ name: symbol, status: "OPEN" }).sort({
        createdAt: 1,
      })
    : memoryOrders
        .filter((order) => order.name === symbol && order.status === "OPEN")
        .reverse();
  for (const order of orders) {
    const fillPrice = executionPriceFor(order.mode, quote);
    if (fillPrice && isMarketable(order.mode, order.price, fillPrice)) {
      await fillOrder(order, fillPrice);
    }
  }
}

function scheduleOrderMatching(symbol) {
  if (matchingTimers.has(symbol)) return;
  const timer = setTimeout(() => {
    matchingTimers.delete(symbol);
    matchingQueue = matchingQueue
      .then(() => matchOpenOrders(symbol))
      .catch((error) =>
        console.warn(`Order matching failed for ${symbol}: ${error.message}`),
      );
  }, 250);
  timer.unref?.();
  matchingTimers.set(symbol, timer);
}

app.post("/newOrder", requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || "")
      .trim()
      .toUpperCase();
    const qty = Number(req.body.qty);
    const price = Number(req.body.price);
    const mode = String(req.body.mode || "BUY").toUpperCase();
    if (
      !alpacaAssets.has(name) ||
      !Number.isInteger(qty) ||
      qty <= 0 ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !["BUY", "SELL"].includes(mode)
    ) {
      return res.status(400).json({
        error:
          "A supported symbol, whole-share quantity, and price are required",
      });
    }

    try {
      await refreshRequestedQuotes([name]);
    } catch (error) {
      console.warn(`Unable to refresh ${name} before order: ${error.message}`);
    }
    if (!executionPriceFor(mode, getMarketQuote(name))) {
      return res.status(503).json({
        error: `A current Alpaca quote is unavailable for ${name}`,
      });
    }

    const userId = req.user.id;
    const holding = await getUserHolding(userId, name);
    if (mode === "SELL" && (!holding || holding.qty < qty)) {
      return res
        .status(400)
        .json({ error: `You do not own ${qty} shares of ${name}` });
    }

    const orderData = { userId, name, qty, price, mode, status: "OPEN" };
    const order = databaseConnected
      ? await OrdersModel.create(orderData)
      : {
          _id: `order-${Date.now()}-${crypto.randomUUID()}`,
          createdAt: new Date(),
          ...orderData,
        };
    if (!databaseConnected) memoryOrders.unshift(order);
    addDesiredStreamSymbol(name);

    const quote = getMarketQuote(name);
    const fillPrice = executionPriceFor(mode, quote);
    if (fillPrice && isMarketable(mode, price, fillPrice))
      await fillOrder(order, fillPrice);
    else if (!databaseConnected) persistLocalStore();

    const user = databaseConnected
      ? await UsersModel.findById(userId)
      : findLocalUser(userId);
    return res.status(201).json({ order, cash: user?.cash });
  } catch (error) {
    console.warn(`Unable to save order: ${error.message}`);
    return res.status(500).json({ error: "Unable to save order" });
  }
});

async function startServer() {
  if (uri) {
    let deadline;
    try {
      const connectionAttempt = mongoose.connect(mongoConnectionUri(uri), {
        serverSelectionTimeoutMS: mongoStartupTimeoutMs,
        connectTimeoutMS: mongoStartupTimeoutMs,
      });
      const startupDeadline = new Promise((_, reject) => {
        deadline = setTimeout(
          () =>
            reject(
              new Error(
                `connection attempt exceeded ${mongoStartupTimeoutMs}ms`,
              ),
            ),
          mongoStartupTimeoutMs,
        );
      });
      await Promise.race([connectionAttempt, startupDeadline]);
      databaseConnected = true;
      console.log("MongoDB Atlas connected; using persistent database storage");
    } catch (error) {
      // Stop an in-flight driver connection so it cannot replace the local store later.
      mongoose.disconnect().catch(() => {});
      console.warn(
        `MongoDB unavailable; using local development storage: ${error.message}`,
      );
    } finally {
      clearTimeout(deadline);
    }
  } else {
    console.warn(
      "No valid MongoDB URI is configured; using local development storage",
    );
  }

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
  startAlpacaMarketData().catch((error) => {
    marketDataState.status = "error";
    console.warn(`Alpaca market data failed to start: ${error.message}`);
    scheduleReconnect();
  });
}

startServer().catch((error) => {
  console.error("Backend startup failed:", error.message);
  process.exit(1);
});
