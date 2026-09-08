export function stockSearchRank(stock, query) {
  const normalizedQuery = String(query || "").trim().toUpperCase();
  const symbol = String(stock.symbol || "").toUpperCase();
  const name = String(stock.name || "").toUpperCase();
  if (symbol === normalizedQuery) return 0;
  if (symbol.startsWith(normalizedQuery)) return 1;
  if (name.startsWith(normalizedQuery)) return 2;
  if (symbol.includes(normalizedQuery)) return 3;
  if (name.includes(normalizedQuery)) return 4;
  return 5;
}

export function rankStockMatches(stocks, query) {
  return stocks
    .map((stock, index) => ({ stock, index }))
    .sort(
      (left, right) =>
        stockSearchRank(left.stock, query) -
          stockSearchRank(right.stock, query) ||
        String(left.stock.symbol).localeCompare(String(right.stock.symbol)) ||
        left.index - right.index,
    )
    .map(({ stock }) => stock);
}
