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

test("health is public and all other routes require a JWT subject", async () => {
  const health = await handler({ rawPath: "/api/health", requestContext: { http: { method: "GET" } } });
  assert.equal(health.statusCode, 200);
  const protectedResponse = await handler({ rawPath: "/api/account", requestContext: { http: { method: "GET" } } });
  assert.equal(protectedResponse.statusCode, 401);
});
