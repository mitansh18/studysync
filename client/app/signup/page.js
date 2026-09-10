"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import SessionPanel from "@/components/SessionPanel";
import { useAuth } from "@/context/AuthContext";

export default function SignupPage() {
  const { signup } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (event) => setForm({ ...form, [field]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);

    const { ok, data } = await signup(form);

    setResult({ ok, message: data.message });
    setSubmitting(false);

    if (ok) {
      router.push("/dashboard");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md p-8">
      <h1 className="text-2xl font-bold">Sign up</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <input
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="Name"
          value={form.name}
          onChange={update("name")}
        />
        <input
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={update("email")}
        />
        <input
          className="rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="Password"
          type="password"
          value={form.password}
          onChange={update("password")}
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {submitting ? "Creating..." : "Sign up"}
        </button>
      </form>

      {result ? (
        <p
          className={`mt-4 text-sm ${result.ok ? "text-emerald-600" : "text-red-600"}`}
          data-testid="signup-result"
        >
          {result.message}
        </p>
      ) : null}

      <SessionPanel />

      <p className="mt-6 text-sm">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
