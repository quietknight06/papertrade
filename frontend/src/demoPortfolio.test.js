import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDemoSession,
  demoPortfolioRequest,
} from "./demoPortfolio.js";

function installSessionStorage() {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test.beforeEach(installSessionStorage);

test("demo funds and trades stay in session state", async () => {
  await demoPortfolioRequest("/funds", {
    method: "POST",
    body: JSON.stringify({ amount: 500, direction: "DEPOSIT" }),
  });
  await demoPortfolioRequest("/newOrder", {
    method: "POST",
    body: JSON.stringify({ name: "AAPL", qty: 2, price: 100, mode: "BUY" }),
  });
  await demoPortfolioRequest("/newOrder", {
    method: "POST",
    body: JSON.stringify({ name: "AAPL", qty: 1, price: 110, mode: "SELL" }),
  });

  assert.deepEqual(await demoPortfolioRequest("/account"), { cash: 10410 });
  assert.equal((await demoPortfolioRequest("/allHoldings"))[0].qty, 1);
  assert.equal((await demoPortfolioRequest("/allOrders")).length, 2);
});

test("demo prevents invalid sales and resets to the starting portfolio", async () => {
  await assert.rejects(
    demoPortfolioRequest("/newOrder", {
      method: "POST",
      body: JSON.stringify({ name: "MSFT", qty: 1, price: 200, mode: "SELL" }),
    }),
    /do not own/,
  );

  await demoPortfolioRequest("/funds", {
    method: "POST",
    body: JSON.stringify({ amount: 250, direction: "DEPOSIT" }),
  });
  clearDemoSession();
  assert.deepEqual(await demoPortfolioRequest("/account"), { cash: 10000 });
  assert.deepEqual(await demoPortfolioRequest("/allHoldings"), []);
  assert.deepEqual(await demoPortfolioRequest("/allOrders"), []);
});

test("demo enforces buying power and withdrawal limits", async () => {
  await assert.rejects(
    demoPortfolioRequest("/newOrder", {
      method: "POST",
      body: JSON.stringify({ name: "NVDA", qty: 101, price: 100, mode: "BUY" }),
    }),
    /buying power/,
  );
  await assert.rejects(
    demoPortfolioRequest("/funds", {
      method: "POST",
      body: JSON.stringify({ amount: 10001, direction: "WITHDRAW" }),
    }),
    /Insufficient cash/,
  );
  assert.deepEqual(await demoPortfolioRequest("/account"), { cash: 10000 });
});

test("demo calculates weighted cost and removes a fully sold holding", async () => {
  for (const price of [100, 200]) {
    await demoPortfolioRequest("/newOrder", {
      method: "POST",
      body: JSON.stringify({ name: "AAPL", qty: 2, price, mode: "BUY" }),
    });
  }
  const [holding] = await demoPortfolioRequest("/allHoldings");
  assert.equal(holding.qty, 4);
  assert.equal(holding.avg, 150);

  await demoPortfolioRequest("/newOrder", {
    method: "POST",
    body: JSON.stringify({ name: "AAPL", qty: 4, price: 150, mode: "SELL" }),
  });
  assert.deepEqual(await demoPortfolioRequest("/allHoldings"), []);
  assert.deepEqual(await demoPortfolioRequest("/account"), { cash: 10000 });
});
