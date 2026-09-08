import assert from "node:assert/strict";
import test from "node:test";
import { rankStockMatches, stockSearchRank } from "./stockSearch.js";

test("search ranking prioritizes exact tickers and ticker prefixes", () => {
  const matches = [
    { symbol: "METG", name: "Meta Growth ETF" },
    { symbol: "DBP", name: "Invesco DB Precious Metals Fund" },
    { symbol: "META", name: "Meta Platforms, Inc." },
    { symbol: "METAL", name: "Metals Acquisition Corp" },
  ];

  assert.deepEqual(
    rankStockMatches(matches, "meta").map((stock) => stock.symbol),
    ["META", "METAL", "METG", "DBP"],
  );
});

test("search ranking puts company-name prefixes before broad matches", () => {
  const matches = [
    { symbol: "ZZZ", name: "The Apple Basket Fund" },
    { symbol: "APLE", name: "Apple Hospitality REIT" },
    { symbol: "FRUIT", name: "Apple Growers Holdings" },
  ];

  assert.deepEqual(
    rankStockMatches(matches, "apple").map((stock) => stock.symbol),
    ["APLE", "FRUIT", "ZZZ"],
  );
  assert.equal(stockSearchRank({ symbol: "AAPL", name: "Apple Inc." }, "aapl"), 0);
});
