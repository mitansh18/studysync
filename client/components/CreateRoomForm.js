"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";

const EMPTY_FORM = { name: "", subject: "" };
const GENERIC_FAILURE = "Unable to create room. Please try again.";

const inputClass =
  "rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

export default function CreateRoomForm() {
  const { refreshUser } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdRoom, setCreatedRoom] = useState(null);

  // `submitting` drives the UI, but state updates are asynchronous, so a
  // second click in the same tick would still read the old value. This ref
  // flips synchronously and is what actually blocks a duplicate request.
  const inFlight = useRef(false);

  function update(field) {
    return (event) => setForm({ ...form, [field]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    // Guards a second submit that slips through before the button disables.
    if (inFlight.current) {
      return;
    }

    const name = form.name.trim();
    const subject = form.subject.trim();

    const errors = {};
    if (!name) {
      errors.name = "Room name is required";
    }
    if (!subject) {
      errors.subject = "Subject is required";
    }

    setFieldErrors(errors);
    setFormError(null);

    // Nothing is sent until the client-side checks pass. The backend still
    // validates independently.
    if (Object.keys(errors).length > 0) {
      return;
    }

    inFlight.current = true;
    setSubmitting(true);

    let result;
    try {
      result = await apiFetch("/api/rooms", {
        method: "POST",
        body: { name, subject },
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }

    const { ok, status, data } = result;

    if (ok) {
      setCreatedRoom(data.room);
      setForm(EMPTY_FORM);
      return;
    }

    if (status === 401) {
      await refreshUser();
      router.replace("/login");
      return;
    }

    // 400 messages come from the backend and are safe to show. Anything
    // else stays generic so no internal detail reaches the user.
    setFormError(status === 400 && data.message ? data.message : GENERIC_FAILURE);
  }

  function createAnother() {
    setCreatedRoom(null);
    setFieldErrors({});
    setFormError(null);
  }

  if (createdRoom) {
    return (
      <div
        className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        data-testid="create-room-success"
      >
        <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Room created
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-zinc-500">Name</dt>
            <dd className="font-medium" data-testid="created-room-name">
              {createdRoom.name}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Subject</dt>
            <dd className="font-medium" data-testid="created-room-subject">
              {createdRoom.subject}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Room ID</dt>
            <dd className="font-mono text-xs" data-testid="created-room-id">
              {createdRoom.id}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={createAnother}
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
            data-testid="create-another"
          >
            Create another room
          </button>
          <Link
            href={`/dashboard/rooms/${createdRoom.id}`}
            className="text-sm underline"
            data-testid="open-room"
          >
            Open room
          </Link>
          <Link href="/dashboard" className="text-sm underline">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mt-6 flex flex-col gap-4"
      data-testid="create-room-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="room-name" className="text-sm font-medium">
          Room name
        </label>
        <input
          id="room-name"
          name="name"
          type="text"
          className={inputClass}
          placeholder="e.g. DSA Grind"
          value={form.name}
          onChange={update("name")}
          aria-invalid={fieldErrors.name ? "true" : undefined}
          aria-describedby={fieldErrors.name ? "room-name-error" : undefined}
        />
        {fieldErrors.name ? (
          <p
            id="room-name-error"
            className="text-sm text-red-600"
            data-testid="name-error"
          >
            {fieldErrors.name}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="room-subject" className="text-sm font-medium">
          Subject
        </label>
        <input
          id="room-subject"
          name="subject"
          type="text"
          className={inputClass}
          placeholder="e.g. Computer Networks"
          value={form.subject}
          onChange={update("subject")}
          aria-invalid={fieldErrors.subject ? "true" : undefined}
          aria-describedby={
            fieldErrors.subject ? "room-subject-error" : undefined
          }
        />
        {fieldErrors.subject ? (
          <p
            id="room-subject-error"
            className="text-sm text-red-600"
            data-testid="subject-error"
          >
            {fieldErrors.subject}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        data-testid="create-room-submit"
      >
        {submitting ? "Creating..." : "Create Room"}
      </button>

      {formError ? (
        <p className="text-sm text-red-600" data-testid="form-error">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
