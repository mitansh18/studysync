"use client";

import { useEffect, useRef, useState } from "react";

import { supabase, supabaseConfigError } from "@/lib/supabase";

// SECURITY NOTE - presence is ephemeral, untrusted UI state.
//
// Presence is gated only by the app's MongoDB membership check below: a
// normal app user who is not a member of this room never subscribes, so
// they cannot appear through the app. That gate is not enforcement.
// Supabase Realtime Authorization is NOT configured, and the anon key is
// public by design, so anyone holding it could connect to a room channel
// directly and broadcast the userId of an existing member, making that
// member show as Online. Do not treat presence as a security or
// authorization signal. Proper Realtime Authorization is deferred to a
// later stage.

// One channel per room, so presence in Room 1 is never visible in Room 2.
function channelName(roomId) {
  return `studysync-room-${roomId}`;
}

// Supabase reports one presence entry per connection, so the same user in
// three tabs arrives three times. Collapsing to a Set of ids is what makes
// a user appear exactly once.
function toOnlineIds(presenceState) {
  const ids = new Set();

  Object.values(presenceState).forEach((entries) => {
    entries.forEach((entry) => {
      if (entry && typeof entry.userId === "string") {
        ids.add(entry.userId);
      }
    });
  });

  return ids;
}

const STATUS_LABEL = {
  connecting: "Connecting...",
  SUBSCRIBED: "Live",
  CHANNEL_ERROR: "Presence unavailable",
  TIMED_OUT: "Presence unavailable",
  CLOSED: "Presence disconnected",
};

// This component owns the one channel a client holds per room, because
// presence needs it. Timer and notes broadcasts arrive on that same
// channel, so they are relayed to the page through onTimerUpdate and
// onNotesUpdate rather than opening a second subscription.
// supabase.channel() returns the existing instance for a topic that is
// already open, so a second subscriber would collide anyway.
export default function RoomMembers({
  room,
  currentUserId,
  onTimerUpdate,
  onNotesUpdate,
  onSubscribed,
}) {
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const [status, setStatus] = useState("connecting");
  const channelRef = useRef(null);

  // Kept in a ref so a new callback identity never re-subscribes presence;
  // the effect below keys only on the room, user and membership.
  const onTimerUpdateRef = useRef(onTimerUpdate);
  const onNotesUpdateRef = useRef(onNotesUpdate);
  const onSubscribedRef = useRef(onSubscribed);
  useEffect(() => {
    onTimerUpdateRef.current = onTimerUpdate;
    onNotesUpdateRef.current = onNotesUpdate;
    onSubscribedRef.current = onSubscribed;
  }, [onTimerUpdate, onNotesUpdate, onSubscribed]);

  const isMember = room.members.some((member) => member.id === currentUserId);

  useEffect(() => {
    // App-level gate: the app only subscribes members. This is a UI
    // courtesy, not enforcement - see the security note at the top.
    if (!supabase || !isMember) {
      return undefined;
    }

    const channel = supabase.channel(channelName(room.id), {
      config: { presence: { key: currentUserId } },
    });
    channelRef.current = channel;

    // State updates live in callbacks, which is the pattern
    // react-hooks/set-state-in-effect permits.
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(toOnlineIds(channel.presenceState()));
      })
      .on("presence", { event: "join" }, () => {
        setOnlineIds(toOnlineIds(channel.presenceState()));
      })
      .on("presence", { event: "leave" }, () => {
        setOnlineIds(toOnlineIds(channel.presenceState()));
      })
      // Sent by the server after every successful timer write (Stage 2.4).
      // Presence events above never touch the timer, and vice versa.
      .on("broadcast", { event: "timer" }, ({ payload }) => {
        if (onTimerUpdateRef.current) {
          onTimerUpdateRef.current(payload);
        }
      })
      // Sent by the server after every successful notes save (Stage 3.2).
      .on("broadcast", { event: "notes" }, ({ payload }) => {
        if (onNotesUpdateRef.current) {
          onNotesUpdateRef.current(payload);
        }
      })
      .subscribe((nextStatus) => {
        setStatus(nextStatus);

        if (nextStatus === "SUBSCRIBED") {
          // Only the id is broadcast. Names are read from the room's member
          // list, so nothing sensitive crosses the realtime connection.
          channel.track({ userId: currentUserId });

          // Fires on the first join and on every automatic rejoin, so the
          // page can close the gap between its fetch and live delivery.
          if (onSubscribedRef.current) {
            onSubscribedRef.current();
          }
        }
      });

    // Removing the channel on unmount is what stops Strict Mode's
    // double-invoke, a room change, or navigating away from leaving a second
    // live subscription behind.
    return () => {
      channelRef.current = null;
      setOnlineIds(new Set());
      supabase.removeChannel(channel);
    };
  }, [room.id, currentUserId, isMember]);

  return (
    <div
      className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      data-testid="room-members"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Room Members
        </h2>
        <span className="text-xs text-zinc-500" data-testid="presence-status">
          {supabaseConfigError
            ? "Presence unavailable"
            : !isMember
              ? "Join this room to appear online"
              : (STATUS_LABEL[status] ?? status)}
        </span>
      </div>

      <ul className="mt-3 space-y-2 text-sm" data-testid="member-list">
        {room.members.map((member) => {
          const online = onlineIds.has(member.id);

          return (
            <li
              key={member.id}
              className="flex items-center gap-2"
              data-testid="member-row"
              data-member-id={member.id}
              data-online={online ? "true" : "false"}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  online ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                }`}
              />
              <span className="font-medium">{member.name}</span>
              {member.id === room.hostId ? (
                <span className="text-xs text-zinc-500">(host)</span>
              ) : null}
              <span
                className={`ml-auto text-xs ${
                  online ? "text-emerald-600" : "text-zinc-500"
                }`}
              >
                {online ? "Online" : "Offline"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
