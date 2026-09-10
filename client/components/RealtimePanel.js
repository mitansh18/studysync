"use client";

import { useEffect, useRef, useState } from "react";

import { supabase, supabaseConfigError } from "@/lib/supabase";

const CHANNEL_NAME = "studysync-stage08";
const EVENT_NAME = "test-message";

// Maps Supabase subscription states onto something readable, without ever
// claiming a connection that did not actually succeed.
const STATUS_LABEL = {
  connecting: "Connecting...",
  SUBSCRIBED: "Connected",
  CHANNEL_ERROR: "Connection failed",
  TIMED_OUT: "Connection timed out",
  CLOSED: "Disconnected",
  DISCONNECTED: "Connection lost",
};

export default function RealtimePanel({ senderName = "StudySync tester" }) {
  const [status, setStatus] = useState("connecting");
  const [events, setEvents] = useState([]);
  const [sendError, setSendError] = useState(null);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    const channel = supabase.channel(CHANNEL_NAME);
    channelRef.current = channel;

    channel
      // State updates live in callbacks, which is the pattern
      // react-hooks/set-state-in-effect permits.
      .on("broadcast", { event: EVENT_NAME }, ({ payload }) => {
        setEvents((previous) => [
          ...previous,
          {
            id: `${Date.now()}-${Math.random()}`,
            message: payload?.message ?? "(no message)",
            sender: payload?.sender ?? "unknown",
            receivedAt: new Date().toLocaleTimeString(),
          },
        ]);
      })
      .subscribe((nextStatus) => {
        setStatus(nextStatus);
      });

    // A channel can look SUBSCRIBED while the underlying socket has quietly
    // died (a backgrounded tab, for example). The heartbeat is the only
    // signal for that, so the badge never claims a connection we do not have.
    // onHeartbeat assigns rather than appends, so it cannot stack up.
    supabase.realtime.onHeartbeat((heartbeat) => {
      if (heartbeat === "disconnected" || heartbeat === "timeout" || heartbeat === "error") {
        setStatus("DISCONNECTED");
      } else if (heartbeat === "ok" && channel.state === "joined") {
        setStatus("SUBSCRIBED");
      }
    });

    // Removing the channel on unmount is what stops Strict Mode's
    // double-invoke from leaving a second live subscription behind.
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, []);

  async function sendTestEvent() {
    setSendError(null);

    const channel = channelRef.current;
    if (!channel || status !== "SUBSCRIBED") {
      setSendError("Not connected yet.");
      return;
    }

    const result = await channel.send({
      type: "broadcast",
      event: EVENT_NAME,
      payload: { message: "Hello from StudySync", sender: senderName },
    });

    if (result !== "ok") {
      setSendError(`Send failed: ${result}`);
    }
  }

  if (supabaseConfigError) {
    return (
      <div className="rounded-lg border border-red-300 p-4 dark:border-red-800">
        <p className="text-sm text-red-600" data-testid="realtime-status">
          {supabaseConfigError}
        </p>
      </div>
    );
  }

  const connected = status === "SUBSCRIBED";

  return (
    <div
      className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      data-testid="realtime-panel"
    >
      <p className="text-sm">
        Realtime Status:{" "}
        <span
          className={connected ? "font-medium text-emerald-600" : "font-medium"}
          data-testid="realtime-status"
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </p>

      <button
        type="button"
        onClick={sendTestEvent}
        disabled={!connected}
        className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        data-testid="send-event"
      >
        Send Test Event
      </button>

      {sendError ? (
        <p className="mt-2 text-sm text-red-600" data-testid="send-error">
          {sendError}
        </p>
      ) : null}

      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Received Events
      </h3>

      <p className="mt-1 text-xs text-zinc-500" data-testid="event-count">
        {events.length} received
      </p>

      <ul className="mt-2 space-y-1 text-sm" data-testid="event-list">
        {events.length === 0 ? (
          <li className="text-zinc-500">Nothing yet.</li>
        ) : (
          events.map((event) => (
            <li key={event.id}>
              {event.message} — {event.sender} ({event.receivedAt})
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
