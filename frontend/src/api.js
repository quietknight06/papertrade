export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("trading-token");
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
      clearSession();
      if (window.location.pathname.startsWith("/dashboard")) window.location.assign("/signup");
    }
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("trading-user"));
  } catch {
    return null;
  }
}

export function hasSession() {
  return Boolean(localStorage.getItem("trading-token") && getStoredUser());
}

export function storeSession({ user, token }) {
  localStorage.setItem("trading-user", JSON.stringify(user));
  localStorage.setItem("trading-token", token);
}

export function clearSession() {
  localStorage.removeItem("trading-user");
  localStorage.removeItem("trading-token");
}
