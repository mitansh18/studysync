"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import CreateRoomForm from "@/components/CreateRoomForm";
import { useAuth } from "@/context/AuthContext";

export default function CreateRoomPage() {
  const { user, loading, error } = useAuth();
  const router = useRouter();

  // Same guard as the dashboard: only redirect once the session check has
  // finished, and never when the auth server was simply unreachable.
  useEffect(() => {
    if (!loading && !user && !error) {
      router.replace("/login");
    }
  }, [loading, user, error, router]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-md p-8">
        <p data-testid="page-state">Checking your session...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-md p-8">
        <p className="text-red-600" data-testid="page-state">
          {error}
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-md p-8">
        <p data-testid="page-state">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md p-8" data-testid="create-room-page">
      <h1 className="text-2xl font-bold">Create a room</h1>

      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Start a study room and invite others to join.
      </p>

      <CreateRoomForm />

      <p className="mt-8 text-sm">
        <Link href="/dashboard" className="underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
