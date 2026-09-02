import { accessToken } from "./auth.jsx";

export async function apiRequest(path, options = {}) {
  const token = await accessToken();
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Cannot reach the trading API. Start the site with npm run dev so the API and Vite run together.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      if (window.location.pathname.startsWith("/dashboard")) window.location.assign("/signup");
    }
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export function clearSession() {
  // Remove legacy sessions created by the pre-Cognito backend.
  localStorage.removeItem("trading-user");
  localStorage.removeItem("trading-token");
}
