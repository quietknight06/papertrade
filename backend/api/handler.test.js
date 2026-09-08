const assert = require("node:assert/strict");
const test = require("node:test");
const { _test, handler } = require("./handler");

test("money conversion is stable", () => {
  assert.equal(_test.moneyToCents(10.235), 1024);
  assert.equal(_test.centsToMoney(1024), 10.24);
});

test("keys use the Cognito subject", () => {
  assert.deepEqual(_test.profileKey("subject"), { PK: "USER#subject", SK: "PROFILE" });
  assert.deepEqual(_test.holdingKey("subject", "AAPL"), { PK: "USER#subject", SK: "HOLDING#AAPL" });
});

test("asset search ranks an exact ticker above name substring matches", () => {
  const query = "META";
  const assets = [
    { symbol: "DBP", name: "Invesco DB Precious Metals Fund" },
    { symbol: "METG", name: "Leverage Shares 2X Long META Daily ETF" },
    { symbol: "META", name: "Meta Platforms, Inc." },
  ];
  assets.sort((left, right) => _test.assetSearchRank(left, query) - _test.assetSearchRank(right, query));
  assert.equal(assets[0].symbol, "META");
});

test("firstFiniteNumber ignores missing, invalid, zero, and negative values", () => {
  assert.equal(_test.firstFiniteNumber(undefined, NaN, 0, -1, 123.45), 123.45);
  assert.equal(_test.firstFiniteNumber(undefined, null), undefined);
});

test("health and read-only market discovery are public", async () => {
  const health = await handler({ rawPath: "/api/health", requestContext: { http: { method: "GET" } } });
  assert.equal(health.statusCode, 200);
  const assets = await handler({
    rawPath: "/api/assets",
    queryStringParameters: { query: "" },
    requestContext: { http: { method: "GET" } },
  });
  assert.equal(assets.statusCode, 200);
  assert.deepEqual(JSON.parse(assets.body), []);
});

test("portfolio routes still require a JWT subject", async () => {
  const protectedResponse = await handler({ rawPath: "/api/account", requestContext: { http: { method: "GET" } } });
  assert.equal(protectedResponse.statusCode, 401);
});
