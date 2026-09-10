"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/context/AuthContext";

export default function DashboardPage() {
  const { user, loading, error, logout } = useAuth();
  const router = useRouter();

  // Only redirect once the session check has actually finished, and never
  // when the server was unreachable - that is not the same as signed out.
  useEffect(() => {
    if (!loading && !user && !error) {
      router.replace("/login");
    }
  }, [loading, user, error, router]);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-md p-8">
        <p data-testid="dashboard-state">Checking your session...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-md p-8">
        <p className="text-red-600" data-testid="dashboard-state">
          {error}
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-md p-8">
        <p data-testid="dashboard-state">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md p-8" data-testid="dashboard">
      <h1 className="text-2xl font-bold" data-testid="dashboard-welcome">
        Welcome, {user.name}
      </h1>

      <p className="mt-2 text-zinc-600 dark:text-zinc-400" data-testid="dashboard-email">
        {user.email}
      </p>

      <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        You are authenticated.
      </p>

      <p className="mt-6 text-sm">
        <Link href="/dashboard/rooms/new" className="underline">
          Create a room
        </Link>
      </p>

      <p className="mt-2 text-sm">
        <Link href="/dashboard/rooms/join" className="underline">
          Join a room
        </Link>
      </p>

      <p className="mt-2 text-sm">
        <Link href="/dashboard/realtime-test" className="underline">
          Realtime test
        </Link>
      </p>

      <button
        type="button"
        onClick={handleLogout}
        className="mt-8 block rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Log out
      </button>
    </div>
  );
}
