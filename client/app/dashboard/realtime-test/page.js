"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import RealtimePanel from "@/components/RealtimePanel";
import { useAuth } from "@/context/AuthContext";

export default function RealtimeTestPage() {
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
      <div className="mx-auto w-full max-w-xl p-8">
        <p data-testid="page-state">Checking your session...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl p-8">
        <p className="text-red-600" data-testid="page-state">
          {error}
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-xl p-8">
        <p data-testid="page-state">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl p-8">
      <h1 className="text-2xl font-bold">StudySync Realtime Test</h1>

      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Development page for Stage 0.8. Open it in two tabs and send an event
        from one.
      </p>

      <div className="mt-6">
        <RealtimePanel senderName={user.name} />
      </div>

      <p className="mt-6 text-sm">
        <Link href="/dashboard" className="underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
