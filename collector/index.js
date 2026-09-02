require("dotenv").config();

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} = require("@aws-sdk/client-sqs");
const WebSocket = require("ws");

const requiredEnvironment = [
  "TABLE_NAME",
  "ORDER_QUEUE_URL",
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`Missing required environment variable ${name}`);
}

const region = process.env.AWS_REGION || "ca-central-1";
const tableName = process.env.TABLE_NAME;
const queueUrl = process.env.ORDER_QUEUE_URL;
const dataBaseUrl = String(process.env.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets").replace(/\/$/, "");
const tradingBaseUrl = String(process.env.ALPACA_TRADING_BASE_URL || "https://paper-api.alpaca.markets").replace(/\/$/, "");
const feed = process.env.ALPACA_DATA_FEED || "iex";
const flushMs = Math.max(Number(process.env.QUOTE_FLUSH_MS) || 5000, 1000);
const defaultSymbols = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA"];
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
const sqs = new SQSClient({ region });
const assets = new Map();
const openOrders = new Map();
const desiredSymbols = new Set(defaultSymbols);
const latestQuotes = new Map();
const pendingQuotes = new Map();
let socket;
let reconnectDelay = 1000;
let stopping = false;

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": process.env.ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET,
  };
}

function orderCacheKey(order) {
  return `${order.PK}|${order.SK}`;
}

async function scanActiveState() {
  let exclusiveStartKey;
  const seenOpenOrders = new Set();
  do {
    const result = await documentClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: "entityType = :order OR entityType = :holding",
      ExpressionAttributeValues: { ":order": "ORDER", ":holding": "HOLDING" },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of result.Items || []) {
      if (item.entityType === "ORDER" && item.status === "OPEN") {
        const key = orderCacheKey(item);
        seenOpenOrders.add(key);
        openOrders.set(key, item);
        desiredSymbols.add(item.symbol);
      }
      if (item.entityType === "HOLDING" && Number(item.quantity) > 0) desiredSymbols.add(item.symbol);
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  for (const key of openOrders.keys()) {
    if (!seenOpenOrders.has(key)) openOrders.delete(key);
  }
}

async function loadAssets() {
  const response = await fetch(`${tradingBaseUrl}/v2/assets?status=active&asset_class=us_equity`, { headers: alpacaHeaders() });
  if (!response.ok) throw new Error(`Alpaca asset request returned ${response.status}`);
  for (const asset of await response.json()) {
    if (asset.status === "active" && asset.tradable && asset.class === "us_equity" && asset.exchange !== "OTC") {
      assets.set(asset.symbol, { name: asset.name, exchange: asset.exchange });
    }
  }
}

async function refreshSnapshots() {
  const symbols = [...desiredSymbols];
  for (let index = 0; index < symbols.length; index += 50) {
    const batch = symbols.slice(index, index + 50);
    const url = new URL(`${dataBaseUrl}/v2/stocks/snapshots`);
    url.searchParams.set("symbols", batch.join(","));
    url.searchParams.set("feed", feed);
    const response = await fetch(url, { headers: alpacaHeaders() });
    if (!response.ok) throw new Error(`Alpaca snapshot request returned ${response.status}`);
    const payload = await response.json();
    const snapshots = payload.snapshots || payload;
    for (const symbol of batch) {
      const snapshot = snapshots[symbol];
      if (!snapshot) continue;
      receiveQuote(symbol, {
        price: snapshot.latestTrade?.p ?? snapshot.minuteBar?.c ?? snapshot.dailyBar?.c,
        bid: snapshot.latestQuote?.bp,
        ask: snapshot.latestQuote?.ap,
        previousClose: snapshot.prevDailyBar?.c,
      }, false);
    }
  }
}

function receiveQuote(symbol, values, shouldMatch = true) {
  const previous = latestQuotes.get(symbol) || {};
  const quote = {
    ...previous,
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => Number.isFinite(Number(value)))),
    symbol,
    name: assets.get(symbol)?.name || symbol,
    exchange: assets.get(symbol)?.exchange || "US",
    updatedAt: new Date().toISOString(),
  };
  latestQuotes.set(symbol, quote);
  pendingQuotes.set(symbol, quote);
  if (shouldMatch) matchOrders(symbol, quote).catch((error) => console.error("Order matching failed", { symbol, message: error.message }));
}

function executionPrice(order, quote) {
  if (order.side === "BUY") return Number(quote.ask || quote.price);
  return Number(quote.bid || quote.price);
}

function isMarketable(order, priceCents) {
  return order.side === "BUY" ? Number(order.limitPriceCents) >= priceCents : Number(order.limitPriceCents) <= priceCents;
}

async function rejectOrder(order, reason) {
  await documentClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: order.PK, SK: order.SK },
    UpdateExpression: "SET #status = :rejected, rejectionReason = :reason, updatedAt = :now REMOVE GSI1PK, GSI1SK",
    ConditionExpression: "#status = :open",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: { ":rejected": "REJECTED", ":open": "OPEN", ":reason": reason, ":now": new Date().toISOString() },
  }));
  openOrders.delete(orderCacheKey(order));
}

async function fillOrder(order, fillPrice) {
  const priceCents = Math.round(fillPrice * 100);
  const quantity = Number(order.quantity);
  const cashDelta = priceCents * quantity * (order.side === "BUY" ? -1 : 1);
  const holdingKey = { PK: order.PK, SK: `HOLDING#${order.symbol}` };
  let basisReduction = 0;
  if (order.side === "SELL") {
    const holding = await documentClient.send(new GetCommand({ TableName: tableName, Key: holdingKey, ConsistentRead: true }));
    const heldQuantity = Number(holding.Item?.quantity || 0);
    if (heldQuantity < quantity) return rejectOrder(order, "Insufficient shares at fill time");
    const totalCostCents = Number(holding.Item.totalCostCents || 0);
    basisReduction = quantity === heldQuantity ? totalCostCents : Math.round((totalCostCents / heldQuantity) * quantity);
  }
  const now = new Date().toISOString();
  const profileUpdate = {
    Update: {
      TableName: tableName,
      Key: { PK: order.PK, SK: "PROFILE" },
      UpdateExpression: "ADD cashCents :delta",
      ConditionExpression: order.side === "BUY" ? "cashCents >= :cost" : "attribute_exists(PK)",
      ExpressionAttributeValues: order.side === "BUY" ? { ":delta": cashDelta, ":cost": -cashDelta } : { ":delta": cashDelta },
    },
  };
  const holdingUpdate = order.side === "BUY"
    ? {
        Update: {
          TableName: tableName,
          Key: holdingKey,
          UpdateExpression: "SET entityType = :type, symbol = :symbol, updatedAt = :now ADD quantity :qty, totalCostCents :cost",
          ExpressionAttributeValues: { ":type": "HOLDING", ":symbol": order.symbol, ":now": now, ":qty": quantity, ":cost": priceCents * quantity },
        },
      }
    : {
        Update: {
          TableName: tableName,
          Key: holdingKey,
          UpdateExpression: "SET updatedAt = :now ADD quantity :negativeQty, totalCostCents :negativeBasis",
          ConditionExpression: "quantity >= :qty",
          ExpressionAttributeValues: { ":now": now, ":negativeQty": -quantity, ":negativeBasis": -basisReduction, ":qty": quantity },
        },
      };
  try {
    await documentClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: { PK: order.PK, SK: order.SK },
            UpdateExpression: "SET #status = :filled, fillPriceCents = :price, filledAt = :now, updatedAt = :now REMOVE GSI1PK, GSI1SK",
            ConditionExpression: "#status = :open",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":filled": "FILLED", ":open": "OPEN", ":price": priceCents, ":now": now },
          },
        },
        profileUpdate,
        holdingUpdate,
      ],
    }));
    openOrders.delete(orderCacheKey(order));
    console.log("Order filled", { orderId: order.orderId, symbol: order.symbol, side: order.side, quantity, fillPrice });
  } catch (error) {
    if (error.name === "TransactionCanceledException") {
      try {
        await rejectOrder(order, order.side === "BUY" ? "Insufficient cash at fill time" : "Holding changed before fill");
      } catch (rejectionError) {
        if (rejectionError.name !== "ConditionalCheckFailedException") throw rejectionError;
        openOrders.delete(orderCacheKey(order));
      }
      return;
    }
    throw error;
  }
}

async function matchOrders(symbol, quote) {
  for (const order of [...openOrders.values()].filter((candidate) => candidate.symbol === symbol)) {
    const price = executionPrice(order, quote);
    const priceCents = Math.round(price * 100);
    if (Number.isFinite(price) && price > 0 && isMarketable(order, priceCents)) await fillOrder(order, price);
  }
}

async function flushQuotes() {
  const batch = [...pendingQuotes.values()];
  pendingQuotes.clear();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const outcomes = await Promise.allSettled(batch.map((quote) => documentClient.send(new PutCommand({
    TableName: tableName,
    Item: { PK: "MARKET", SK: `QUOTE#${quote.symbol}`, entityType: "QUOTE", ...quote, expiresAt },
  }))));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      const quote = batch[index];
      pendingQuotes.set(quote.symbol, quote);
      console.error("Quote write failed", { symbol: quote.symbol, message: outcome.reason.message });
    }
  });
}

function updateSubscription() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ action: "subscribe", trades: [...desiredSymbols], quotes: [...desiredSymbols], bars: [...desiredSymbols] }));
}

function connectStream() {
  if (stopping) return;
  socket = new WebSocket(`wss://stream.data.alpaca.markets/v2/${feed}`);
  socket.on("open", () => socket.send(JSON.stringify({ action: "auth", key: process.env.ALPACA_API_KEY, secret: process.env.ALPACA_API_SECRET })));
  socket.on("message", (data) => {
    let messages;
    try { messages = JSON.parse(String(data)); } catch { return; }
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      if (message.T === "success" && message.msg === "authenticated") {
        reconnectDelay = 1000;
        updateSubscription();
      } else if (message.T === "t") receiveQuote(message.S, { price: message.p });
      else if (message.T === "q") receiveQuote(message.S, { bid: message.bp, ask: message.ap });
      else if (message.T === "b") receiveQuote(message.S, { price: message.c });
      else if (message.T === "error") console.error("Alpaca stream error", { code: message.code, message: message.msg });
    }
  });
  socket.on("error", (error) => console.error("Alpaca socket error", { message: error.message }));
  socket.on("close", () => {
    if (stopping) return;
    setTimeout(connectStream, reconnectDelay).unref();
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
}

async function consumeOrders() {
  while (!stopping) {
    try {
      const result = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 20, MaxNumberOfMessages: 10, VisibilityTimeout: 30 }));
      for (const message of result.Messages || []) {
        const event = JSON.parse(message.Body);
        if (event.action === "UPSERT" && event.order?.status === "OPEN") {
          openOrders.set(orderCacheKey(event.order), event.order);
          const isNewSymbol = !desiredSymbols.has(event.order.symbol);
          desiredSymbols.add(event.order.symbol);
          if (isNewSymbol) updateSubscription();
          const quote = latestQuotes.get(event.order.symbol);
          if (quote) await matchOrders(event.order.symbol, quote);
        }
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    } catch (error) {
      console.error("Order queue receive failed", { message: error.message });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function start() {
  await Promise.all([loadAssets(), scanActiveState()]);
  await refreshSnapshots();
  setInterval(() => flushQuotes().catch((error) => console.error("Quote flush failed", { message: error.message })), flushMs).unref();
  setInterval(() => refreshSnapshots().catch((error) => console.error("Snapshot refresh failed", { message: error.message })), 60000).unref();
  setInterval(() => scanActiveState().catch((error) => console.error("Order reconciliation failed", { message: error.message })), 60000).unref();
  connectStream();
  consumeOrders().catch((error) => { console.error("Collector stopped", error); process.exitCode = 1; });
  console.log("PaperTrade collector started", { region, symbols: [...desiredSymbols], flushMs });
}

async function stop() {
  stopping = true;
  socket?.close();
  await flushQuotes();
}

process.on("SIGTERM", () => stop().finally(() => process.exit(0)));
process.on("SIGINT", () => stop().finally(() => process.exit(0)));

start().catch((error) => {
  console.error("Collector startup failed", { message: error.message, stack: error.stack });
  process.exit(1);
});
