const {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const crypto = require("node:crypto");

const tableName = process.env.TABLE_NAME;
const orderQueueUrl = process.env.ORDER_QUEUE_URL;
const alpacaParameter = process.env.ALPACA_PARAMETER;
const region = process.env.AWS_REGION;
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});
const sqs = new SQSClient({ region });
const ssm = new SSMClient({ region });
const defaultSymbols = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA"];
const fallbackPrices = { AAPL: 229, MSFT: 417.14, NVDA: 108.38, AMZN: 178.5, GOOGL: 165.86, TSLA: 214.11 };
let cachedAlpacaCredentials;
let cachedAssets = { expiresAt: 0, values: [] };

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 });
  }
}

function claims(event) {
  return event.requestContext?.authorizer?.jwt?.claims || {};
}

function userId(event) {
  const sub = claims(event).sub;
  if (!sub) throw Object.assign(new Error("Authentication is required"), { statusCode: 401 });
  return String(sub);
}

function moneyToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function centsToMoney(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function profileKey(id) {
  return { PK: `USER#${id}`, SK: "PROFILE" };
}

function holdingKey(id, symbol) {
  return { PK: `USER#${id}`, SK: `HOLDING#${symbol}` };
}

async function ensureProfile(event) {
  const id = userId(event);
  const jwt = claims(event);
  const key = profileKey(id);
  await documentClient.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: "SET email = if_not_exists(email, :email), displayName = if_not_exists(displayName, :name), cashCents = if_not_exists(cashCents, :cash), createdAt = if_not_exists(createdAt, :now), entityType = :type",
    ExpressionAttributeValues: {
      ":email": String(jwt.email || ""),
      ":name": String(jwt.name || jwt.email || "Paper Trader"),
      ":cash": 1000000,
      ":now": new Date().toISOString(),
      ":type": "PROFILE",
    },
  }));
  const result = await documentClient.send(new GetCommand({ TableName: tableName, Key: key }));
  return result.Item;
}

async function queryUserItems(id) {
  const result = await documentClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": `USER#${id}` },
  }));
  return result.Items || [];
}

async function quoteItems(symbols) {
  if (!symbols.length) return new Map();
  const result = await documentClient.send(new BatchGetCommand({
    RequestItems: {
      [tableName]: { Keys: symbols.map((symbol) => ({ PK: "MARKET", SK: `QUOTE#${symbol}` })) },
    },
  }));
  return new Map((result.Responses?.[tableName] || []).map((item) => [item.symbol, item]));
}

async function holdingsForUser(id) {
  const items = await queryUserItems(id);
  const holdings = items.filter((item) => item.entityType === "HOLDING" && Number(item.quantity) > 0);
  const quotes = await quoteItems(holdings.map((item) => item.symbol));
  return holdings.map((item) => {
    const quote = quotes.get(item.symbol) || {};
    const averageCostCents = Number(item.averageCostCents ?? Math.round(Number(item.totalCostCents || 0) / Number(item.quantity || 1)));
    const price = Number.isFinite(Number(quote.price)) ? Number(quote.price) : centsToMoney(averageCostCents);
    const previousClose = Number(quote.previousClose);
    const dayChange = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;
    return {
      _id: item.SK,
      name: item.symbol,
      qty: Number(item.quantity),
      avg: centsToMoney(averageCostCents),
      price,
      day: `${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}%`,
      isLoss: price < centsToMoney(averageCostCents),
    };
  });
}

async function getAlpacaCredentials() {
  if (cachedAlpacaCredentials) return cachedAlpacaCredentials;
  const value = await ssm.send(new GetParameterCommand({ Name: alpacaParameter, WithDecryption: true }));
  cachedAlpacaCredentials = JSON.parse(value.Parameter.Value);
  return cachedAlpacaCredentials;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function assetSearchRank(asset, query) {
  const symbol = String(asset.symbol || "").toUpperCase();
  const name = String(asset.name || "").toUpperCase();
  if (symbol === query) return 0;
  if (symbol.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  if (symbol.includes(query)) return 3;
  if (name.includes(query)) return 4;
  return 5;
}

async function alpacaSnapshots(symbols) {
  if (!symbols.length) return new Map();
  const credentials = await getAlpacaCredentials();
  const baseUrl = String(credentials.dataBaseUrl || "https://data.alpaca.markets").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/v2/stocks/snapshots`);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("feed", "iex");
  const request = await fetch(url, {
    headers: { "APCA-API-KEY-ID": credentials.key, "APCA-API-SECRET-KEY": credentials.secret },
  });
  if (!request.ok) throw new Error(`Alpaca snapshot request returned ${request.status}`);
  const payload = await request.json();
  const snapshots = payload.snapshots || payload;
  const results = new Map();
  const updatedAt = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  for (const symbol of symbols) {
    const snapshot = snapshots[symbol];
    if (!snapshot) continue;
    const price = firstFiniteNumber(snapshot.latestTrade?.p, snapshot.minuteBar?.c, snapshot.dailyBar?.c);
    if (!price) continue;
    results.set(symbol, {
      PK: "MARKET",
      SK: `QUOTE#${symbol}`,
      entityType: "QUOTE",
      symbol,
      name: symbol,
      exchange: "US",
      price,
      bid: firstFiniteNumber(snapshot.latestQuote?.bp, price),
      ask: firstFiniteNumber(snapshot.latestQuote?.ap, price),
      previousClose: firstFiniteNumber(snapshot.prevDailyBar?.c, price),
      updatedAt,
      expiresAt,
    });
  }
  return results;
}

async function alpacaAssets() {
  if (cachedAssets.expiresAt > Date.now()) return cachedAssets.values;
  const credentials = await getAlpacaCredentials();
  const baseUrl = String(credentials.tradingBaseUrl || "https://paper-api.alpaca.markets").replace(/\/$/, "");
  const request = await fetch(`${baseUrl}/v2/assets?status=active&asset_class=us_equity`, {
    headers: { "APCA-API-KEY-ID": credentials.key, "APCA-API-SECRET-KEY": credentials.secret },
  });
  if (!request.ok) throw new Error(`Alpaca assets request returned ${request.status}`);
  const payload = await request.json();
  const values = payload.filter((asset) => asset.status === "active" && asset.tradable && asset.class === "us_equity" && asset.exchange !== "OTC").map((asset) => ({
    symbol: asset.symbol,
    name: asset.name,
    exchange: asset.exchange,
    tradable: asset.tradable,
    fractionable: asset.fractionable,
    shortable: asset.shortable,
  }));
  cachedAssets = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, values };
  return values;
}

async function routeRequest(event) {
  const method = event.requestContext?.http?.method || "GET";
  const path = event.rawPath || "/";
  if (method === "GET" && path === "/api/health") return response(200, { status: "ok", storage: "dynamodb" });

  const publicMarketRoute =
    method === "GET" && ["/api/quotes", "/api/assets"].includes(path);
  const id = publicMarketRoute ? null : userId(event);
  if (method === "GET" && path === "/api/me") {
    const profile = await ensureProfile(event);
    return response(200, { id, name: profile.displayName, email: profile.email });
  }
  if (method === "POST" && path === "/api/profile") {
    const body = parseBody(event);
    const displayName = String(body.name || "").trim().slice(0, 100);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 320);
    if (displayName.length < 2 || !email.includes("@")) return response(400, { error: "A valid name and email are required" });
    const result = await documentClient.send(new UpdateCommand({
      TableName: tableName,
      Key: profileKey(id),
      UpdateExpression: "SET displayName = :name, email = :email, cashCents = if_not_exists(cashCents, :cash), createdAt = if_not_exists(createdAt, :now), entityType = :type",
      ExpressionAttributeValues: { ":name": displayName, ":email": email, ":cash": 1000000, ":now": new Date().toISOString(), ":type": "PROFILE" },
      ReturnValues: "ALL_NEW",
    }));
    return response(200, { id, name: result.Attributes.displayName, email: result.Attributes.email });
  }
  if (method === "GET" && path === "/api/account") {
    const profile = await ensureProfile(event);
    return response(200, { cash: centsToMoney(profile.cashCents) });
  }
  if (method === "POST" && path === "/api/funds") {
    await ensureProfile(event);
    const body = parseBody(event);
    const amountCents = moneyToCents(body.amount);
    const withdraw = body.direction === "WITHDRAW";
    if (!amountCents || amountCents <= 0) return response(400, { error: "Enter a valid amount" });
    const delta = withdraw ? -amountCents : amountCents;
    const result = await documentClient.send(new UpdateCommand({
      TableName: tableName,
      Key: profileKey(id),
      UpdateExpression: "ADD cashCents :delta",
      ConditionExpression: withdraw ? "cashCents >= :amount" : undefined,
      ExpressionAttributeValues: withdraw ? { ":delta": delta, ":amount": amountCents } : { ":delta": delta },
      ReturnValues: "ALL_NEW",
    }));
    return response(200, { cash: centsToMoney(result.Attributes.cashCents) });
  }
  if (method === "GET" && ["/api/allHoldings", "/api/allPositions"].includes(path)) {
    const holdings = await holdingsForUser(id);
    return response(200, path.endsWith("allPositions") ? holdings.map((item) => ({ ...item, product: "CASH" })) : holdings);
  }
  if (method === "GET" && path === "/api/allOrders") {
    const items = (await queryUserItems(id)).filter((item) => item.entityType === "ORDER").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return response(200, items.map((item) => ({
      _id: item.orderId,
      name: item.symbol,
      qty: item.quantity,
      price: centsToMoney(item.limitPriceCents),
      mode: item.side,
      status: item.status,
      fillPrice: item.fillPriceCents == null ? undefined : centsToMoney(item.fillPriceCents),
      filledAt: item.filledAt,
      rejectionReason: item.rejectionReason,
      createdAt: item.createdAt,
    })));
  }
  if (method === "GET" && path === "/api/watchlist-symbols") {
    const items = await queryUserItems(id);
    const symbols = items.filter((item) => (item.entityType === "HOLDING" && Number(item.quantity) > 0) || (item.entityType === "ORDER" && item.status === "OPEN")).map((item) => item.symbol);
    return response(200, [...new Set(symbols)].sort());
  }
  if (method === "GET" && path === "/api/quotes") {
    const requested = String(event.queryStringParameters?.symbols || "").split(",").map((value) => value.trim().toUpperCase()).filter((value) => /^[A-Z.]{1,10}$/.test(value)).slice(0, 50);
    const symbols = requested.length ? requested : defaultSymbols;
    const quotes = await quoteItems(symbols);
    const now = Date.now();
    const staleSymbols = symbols.filter((symbol) => {
      const updatedAt = Date.parse(quotes.get(symbol)?.updatedAt || "");
      return !Number.isFinite(updatedAt) || now - updatedAt > 15000;
    });
    if (staleSymbols.length) {
      try {
        const snapshots = await alpacaSnapshots(staleSymbols);
        await Promise.allSettled([...snapshots.values()].map((quote) => documentClient.send(new PutCommand({
          TableName: tableName,
          Item: quote,
        }))));
        for (const [symbol, quote] of snapshots) quotes.set(symbol, quote);
      } catch (error) {
        console.error(JSON.stringify({ message: "Unable to refresh Alpaca snapshots", cause: error.message }));
      }
    }
    return response(200, symbols.map((symbol) => {
      const quote = quotes.get(symbol) || {};
      const price = Number(quote.price ?? fallbackPrices[symbol]);
      return {
        symbol,
        name: quote.name || symbol,
        exchange: quote.exchange || "US",
        price: Number.isFinite(price) ? price : null,
        bid: firstFiniteNumber(quote.bid, price) ?? null,
        ask: firstFiniteNumber(quote.ask, price) ?? null,
        previousClose: firstFiniteNumber(quote.previousClose, price) ?? null,
        source: quote.updatedAt ? "alpaca" : "fallback",
        updatedAt: quote.updatedAt || null,
      };
    }));
  }
  if (method === "GET" && path === "/api/assets") {
    const query = String(event.queryStringParameters?.query || "").trim().toUpperCase();
    const limit = Math.min(Math.max(Number(event.queryStringParameters?.limit) || 20, 1), 50);
    if (!query) return response(200, []);
    const matches = (await alpacaAssets())
      .filter((asset) => asset.symbol.includes(query) || asset.name.toUpperCase().includes(query))
      .sort((left, right) => assetSearchRank(left, query) - assetSearchRank(right, query) || left.symbol.localeCompare(right.symbol))
      .slice(0, limit);
    return response(200, matches);
  }
  if (method === "POST" && path === "/api/newOrder") {
    await ensureProfile(event);
    const body = parseBody(event);
    const symbol = String(body.name || "").trim().toUpperCase();
    const quantity = Number(body.qty);
    const limitPriceCents = moneyToCents(body.price);
    const side = String(body.mode || "BUY").toUpperCase();
    if (!/^[A-Z.]{1,10}$/.test(symbol) || !Number.isInteger(quantity) || quantity <= 0 || !limitPriceCents || limitPriceCents <= 0 || !["BUY", "SELL"].includes(side)) {
      return response(400, { error: "A valid symbol, whole-share quantity, price, and side are required" });
    }
    const quote = (await quoteItems([symbol])).get(symbol);
    if (!quote?.updatedAt) return response(503, { error: `A current Alpaca quote is unavailable for ${symbol}` });
    if (side === "SELL") {
      const holding = await documentClient.send(new GetCommand({ TableName: tableName, Key: holdingKey(id, symbol) }));
      if (Number(holding.Item?.quantity || 0) < quantity) return response(400, { error: `You do not own ${quantity} shares of ${symbol}` });
    }
    const orderId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const key = { PK: `USER#${id}`, SK: `ORDER#${createdAt}#${orderId}` };
    const order = { ...key, entityType: "ORDER", orderId, userId: id, symbol, quantity, limitPriceCents, side, status: "OPEN", createdAt, GSI1PK: `OPEN#${symbol}`, GSI1SK: `${createdAt}#${orderId}` };
    await documentClient.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: tableName, Item: order, ConditionExpression: "attribute_not_exists(PK)" } }] }));
    try {
      await sqs.send(new SendMessageCommand({ QueueUrl: orderQueueUrl, MessageBody: JSON.stringify({ action: "UPSERT", PK: key.PK, SK: key.SK, order }) }));
    } catch (error) {
      // The collector reconciles open orders from DynamoDB once per minute.
      console.error(JSON.stringify({ message: "Order persisted but queue notification failed", orderId, cause: error.message }));
    }
    return response(201, { order: { _id: orderId, name: symbol, qty: quantity, price: centsToMoney(limitPriceCents), mode: side, status: "OPEN", createdAt } });
  }
  return response(404, { error: "Route not found" });
}

exports.handler = async (event) => {
  try {
    return await routeRequest(event);
  } catch (error) {
    console.error(JSON.stringify({ message: error.message, name: error.name, requestId: event.requestContext?.requestId }));
    if (error.name === "ConditionalCheckFailedException") return response(400, { error: "The requested balance or holding update is not valid" });
    return response(error.statusCode || 500, { error: error.statusCode ? error.message : "Unable to process request" });
  }
};

exports._test = { assetSearchRank, centsToMoney, firstFiniteNumber, moneyToCents, profileKey, holdingKey };
