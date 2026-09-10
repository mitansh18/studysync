"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";

const GENERIC_FAILURE = "Unable to join room. Please try again.";

const inputClass =
  "rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

export default function JoinRoomForm() {
  const { refreshUser } = useAuth();
  const router = useRouter();

  const [roomId, setRoomId] = useState("");
  const [fieldError, setFieldError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [joinedRoom, setJoinedRoom] = useState(null);

  // `submitting` drives the UI, but state updates are asynchronous, so a
  // second click in the same tick would still read the old value. This ref
  // flips synchronously and is what actually blocks a duplicate request.
  const inFlight = useRef(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (inFlight.current) {
      return;
    }

    const trimmedId = roomId.trim();

    setFormError(null);

    if (!trimmedId) {
      setFieldError("Room ID is required");
      return;
    }

    setFieldError(null);

    inFlight.current = true;
    setSubmitting(true);

    let result;
    try {
      // No body: the room comes from the URL and the joining user comes
      // from the session, so there is nothing for a client to override.
      result = await apiFetch(`/api/rooms/${encodeURIComponent(trimmedId)}/join`, {
        method: "POST",
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }

    const { ok, status, data } = result;

    if (ok) {
      setJoinedRoom(data.room);
      setRoomId("");
      return;
    }

    if (status === 401) {
      await refreshUser();
      router.replace("/login");
      return;
    }

    // 400 and 404 messages come from the backend and are safe to show.
    // Anything else stays generic so no internal detail reaches the user.
    const safeStatus = status === 400 || status === 404;
    setFormError(safeStatus && data.message ? data.message : GENERIC_FAILURE);
  }

  function joinAnother() {
    setJoinedRoom(null);
    setFieldError(null);
    setFormError(null);
  }

  if (joinedRoom) {
    return (
      <div
        className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        data-testid="join-room-success"
      >
        <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Successfully joined room
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-zinc-500">Room</dt>
            <dd className="font-medium" data-testid="joined-room-name">
              {joinedRoom.name}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Subject</dt>
            <dd className="font-medium" data-testid="joined-room-subject">
              {joinedRoom.subject}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Room ID</dt>
            <dd className="font-mono text-xs" data-testid="joined-room-id">
              {joinedRoom.id}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={joinAnother}
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
            data-testid="join-another"
          >
            Join another room
          </button>
          <Link
            href={`/dashboard/rooms/${joinedRoom.id}`}
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
      data-testid="join-room-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="room-id" className="text-sm font-medium">
          Room ID
        </label>
        <input
          id="room-id"
          name="roomId"
          type="text"
          className={inputClass}
          placeholder="Paste the room ID you were given"
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
          aria-invalid={fieldError ? "true" : undefined}
          aria-describedby={fieldError ? "room-id-error" : undefined}
        />
        {fieldError ? (
          <p
            id="room-id-error"
            className="text-sm text-red-600"
            data-testid="room-id-error"
          >
            {fieldError}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        data-testid="join-room-submit"
      >
        {submitting ? "Joining..." : "Join Room"}
      </button>

      {formError ? (
        <p className="text-sm text-red-600" data-testid="form-error">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
