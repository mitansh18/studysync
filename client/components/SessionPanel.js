"use client";

import { useAuth } from "@/context/AuthContext";

// Small session indicator. The session is restored automatically by
// AuthProvider, so there is nothing here to click in order to see it - the
// cookie is httpOnly and only the server can say who is signed in.
export default function SessionPanel() {
  const { user, loading, error, logout } = useAuth();

  return (
    <div
      className="mt-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      data-testid="session-panel"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Session
      </h2>

      <p className="mt-2 text-sm" data-testid="session-status">
        {loading
          ? "Checking your session..."
          : error
            ? error
            : user
              ? `Signed in as ${user.name} (${user.email})`
              : "Not signed in"}
      </p>

      {user ? (
        <button
          type="button"
          onClick={logout}
          className="mt-3 rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Log out
        </button>
      ) : null}
    </div>
  );
}
