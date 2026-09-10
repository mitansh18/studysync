"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { apiFetch } from "@/lib/api";

const AuthContext = createContext(null);

// One object rather than three useState calls, so a session update is a
// single render instead of a cascade.
const INITIAL_STATE = { user: null, loading: true, error: null };

// 401 means "no session", which is a normal outcome - not a failure.
// Anything else means we could not ask, which must not look like a logout.
function toState(result) {
  if (result.ok) {
    return { user: result.data.user, loading: false, error: null };
  }
  if (result.status === 401) {
    return { user: null, loading: false, error: null };
  }
  return {
    user: null,
    loading: false,
    error: "Unable to contact the authentication server",
  };
}

export function AuthProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);

  // Restores the session on load. The httpOnly cookie is attached by the
  // browser; nothing here reads or decodes the token.
  //
  // The state update lives inside a deferred callback rather than a
  // function called synchronously from the effect body - the latter is what
  // react-hooks/set-state-in-effect rejects.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await apiFetch("/api/auth/me");
      if (!cancelled) {
        setState(toState(result));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshUser = useCallback(async () => {
    const result = await apiFetch("/api/auth/me");
    setState(toState(result));
    return result;
  }, []);

  const login = useCallback(async (credentials) => {
    const result = await apiFetch("/api/auth/login", {
      method: "POST",
      body: credentials,
    });
    if (result.ok) {
      setState({ user: result.data.user, loading: false, error: null });
    }
    return result;
  }, []);

  const signup = useCallback(async (details) => {
    const result = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: details,
    });
    if (result.ok) {
      setState({ user: result.data.user, loading: false, error: null });
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
    const result = await apiFetch("/api/auth/logout", { method: "POST" });
    // Clear locally regardless: the user asked to leave, and the next
    // session check corrects the state if the request did not land.
    setState({ user: null, loading: false, error: null });
    return result;
  }, []);

  const value = useMemo(
    () => ({ ...state, login, signup, logout, refreshUser }),
    [state, login, signup, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
