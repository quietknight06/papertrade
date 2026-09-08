import { apiRequest } from "./api.js";
import {
  clearDemoSession,
  demoPortfolioRequest,
} from "./demoPortfolio.js";

export async function demoApiRequest(path, options = {}) {
  // Market data is read-only and shared with the normal dashboard. Portfolio
  // requests never leave this browser tab.
  if (path.startsWith("/quotes") || path.startsWith("/assets")) {
    return apiRequest(path, options);
  }
  return demoPortfolioRequest(path, options);
}

export { clearDemoSession };
