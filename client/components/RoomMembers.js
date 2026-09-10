"use client";

import { useEffect, useRef, useState } from "react";

import { supabase, supabaseConfigError } from "@/lib/supabase";

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

export default function RoomMembers({ room, currentUserId }) {
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  const [status, setStatus] = useState("connecting");
  const channelRef = useRef(null);

  const isMember = room.members.some((member) => member.id === currentUserId);

  useEffect(() => {
    // Presence is only for authenticated members of this room. A non-member
    // never joins the channel, so they never broadcast presence.
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
      .subscribe((nextStatus) => {
        setStatus(nextStatus);

        if (nextStatus === "SUBSCRIBED") {
          // Only the id is broadcast. Names are read from the room's member
          // list, so nothing sensitive crosses the realtime connection.
          channel.track({ userId: currentUserId });
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
