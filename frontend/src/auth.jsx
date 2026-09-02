/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Amplify } from "aws-amplify";
import {
  confirmSignUp as amplifyConfirmSignUp,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from "aws-amplify/auth";

const region = import.meta.env.VITE_AWS_REGION;
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
const configured = Boolean(region && userPoolId && userPoolClientId);

if (configured) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { email: true },
      },
    },
  });
}

const AuthContext = createContext(null);

async function loadUser() {
  if (!configured) return null;
  await getCurrentUser();
  const attributes = await fetchUserAttributes();
  return {
    id: attributes.sub,
    name: attributes.name || attributes.email || "Paper Trader",
    email: attributes.email || "",
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const nextUser = await loadUser();
      setUser(nextUser);
      return nextUser;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    loadUser()
      .then((nextUser) => {
        if (active) setUser(nextUser);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      configured,
      loading,
      user,
      refresh,
      async signUp({ name, email, password }) {
        if (!configured) throw new Error("Cognito is not configured. Add the VITE_COGNITO_* environment variables.");
        return amplifySignUp({
          username: email.trim().toLowerCase(),
          password,
          options: { userAttributes: { email: email.trim().toLowerCase(), name: name.trim() } },
        });
      },
      async confirmSignUp(email, code) {
        return amplifyConfirmSignUp({ username: email.trim().toLowerCase(), confirmationCode: code.trim() });
      },
      async signIn(email, password) {
        const result = await amplifySignIn({ username: email.trim().toLowerCase(), password });
        const signedInUser = result.isSignedIn ? await refresh() : null;
        return { ...result, user: signedInUser };
      },
      async signOut() {
        await amplifySignOut();
        setUser(null);
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export async function accessToken() {
  if (!configured) return null;
  const session = await fetchAuthSession();
  return session.tokens?.accessToken?.toString() || null;
}
