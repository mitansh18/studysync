"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { formatTime, getRemainingSeconds, isTimerState } from "@/lib/timer";

const STATUS_LABEL = { idle: "Idle", running: "Running", paused: "Paused" };

const ACTIONS = {
  start: { label: "Start", failure: "Unable to start the timer." },
  pause: { label: "Pause", failure: "Unable to pause the timer." },
  reset: { label: "Reset", failure: "Unable to reset the timer." },
};

const buttonClass =
  "rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40";

// Shows the room's shared timer and sends Start / Pause / Reset to the API.
// The component never decides what the timer state should become: every
// change comes back from the server (in the action response or, for other
// members, over the room channel). Responses are handed up through the
// page's beginRoomUpdate/applyRoomUpdate pair so one that was overtaken by
// a newer broadcast, or belongs to a room no longer shown, is dropped.
export default function RoomTimer({
  roomId,
  timerState,
  canControl,
  beginRoomUpdate,
  applyRoomUpdate,
}) {
  const { refreshUser } = useAuth();
  const router = useRouter();

  // The server's schema and serializer make an invalid timer state
  // impossible, so this should never be false. If it ever is, the timer
  // says so and disables itself rather than inventing a state or taking the
  // whole room page down with it.
  const valid = isTimerState(timerState);

  // The one clock reading the countdown is derived from. Only a running
  // timer needs it refreshed, so the interval below exists only then.
  const [now, setNow] = useState(() => Date.now());
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState(null);

  // Same lesson as the forms: state is not a synchronous mutex, this ref is.
  const inFlight = useRef(false);

  const running = valid && timerState.status === "running";

  useEffect(() => {
    if (!running) {
      return undefined;
    }

    const tick = () => setNow(Date.now());

    // A timer that starts while this page is already open would otherwise
    // show its full length until the first interval fires.
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);

    // Clearing here is what guarantees a single interval: a pause, reset,
    // room change or unmount removes this one before any other can exist.
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [running]);

  async function runAction(name) {
    if (inFlight.current || !canControl) {
      return;
    }

    inFlight.current = true;
    setPendingAction(name);
    setError(null);

    // Taken before the request so a broadcast that lands while it is in
    // flight makes the response stale.
    const seen = beginRoomUpdate();

    let result;
    try {
      // No body: the server owns status, startedAt and durationSeconds.
      result = await apiFetch(
        `/api/rooms/${encodeURIComponent(roomId)}/timer/${name}`,
        { method: "POST" }
      );
    } finally {
      inFlight.current = false;
      setPendingAction(null);
    }

    const { ok, status, data } = result;

    if (ok) {
      // data.room is the canonical room after the write, timerState included.
      applyRoomUpdate(data.room, seen);
      return;
    }

    if (status === 401) {
      await refreshUser();
      router.replace("/login");
      return;
    }

    // 403 / 409 messages are written for users; anything else stays generic.
    const safe = status === 400 || status === 403 || status === 404 || status === 409;
    setError(safe && data.message ? data.message : ACTIONS[name].failure);

    // A 409 means the controls were acting on stale state (a missed update,
    // or someone else changed the timer first). Re-read the room so what is
    // shown matches what the server has.
    if (status === 409) {
      const seenBeforeRefetch = beginRoomUpdate();
      const fresh = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}`);
      if (fresh.ok) {
        applyRoomUpdate(fresh.data.room, seenBeforeRefetch);
      }
    }
  }

  if (!valid) {
    return (
      <div
        className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        data-testid="room-timer"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Pomodoro Timer
        </h2>
        <p className="mt-3 text-sm text-red-600" role="alert" data-testid="timer-unavailable">
          Timer state unavailable. Reload the room to try again.
        </p>
      </div>
    );
  }

  const remaining = getRemainingSeconds(timerState, now);
  const formatted = formatTime(remaining);
  const busy = pendingAction !== null;

  return (
    <div
      className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      data-testid="room-timer"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Pomodoro Timer
        </h2>
        <span
          className={`text-xs ${running ? "text-emerald-600" : "text-zinc-500"}`}
          data-testid="timer-status"
          aria-live="polite"
        >
          {STATUS_LABEL[timerState.status]}
        </span>
      </div>

      <p
        className="mt-3 font-mono text-5xl font-semibold tabular-nums"
        data-testid="timer-countdown"
        aria-label={`${formatted} remaining`}
      >
        {formatted}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => runAction("start")}
          disabled={busy || !canControl || running}
          className={`${buttonClass} bg-indigo-600 hover:bg-indigo-500`}
          data-testid="timer-start"
        >
          {ACTIONS.start.label}
        </button>
        <button
          type="button"
          onClick={() => runAction("pause")}
          disabled={busy || !canControl || !running}
          className={`${buttonClass} bg-amber-600 hover:bg-amber-500`}
          data-testid="timer-pause"
        >
          {ACTIONS.pause.label}
        </button>
        <button
          type="button"
          onClick={() => runAction("reset")}
          disabled={busy || !canControl}
          className={`${buttonClass} bg-zinc-600 hover:bg-zinc-500`}
          data-testid="timer-reset"
        >
          {ACTIONS.reset.label}
        </button>
        {busy ? (
          <span className="text-xs text-zinc-500" data-testid="timer-loading">
            Updating timer...
          </span>
        ) : null}
      </div>

      {!canControl ? (
        <p className="mt-2 text-xs text-zinc-500" data-testid="timer-hint">
          Join this room to control the timer
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert" data-testid="timer-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
