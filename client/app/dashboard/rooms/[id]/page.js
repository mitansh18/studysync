"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import RoomMembers from "@/components/RoomMembers";
import RoomTimer from "@/components/RoomTimer";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { isTimerState } from "@/lib/timer";

const GENERIC_FAILURE = "Unable to load this room. Please try again.";

export default function RoomPage() {
  const { user, loading, error, refreshUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const roomId = typeof params.id === "string" ? params.id : "";

  const [room, setRoom] = useState(null);
  const [roomError, setRoomError] = useState(null);
  const [loadingRoom, setLoadingRoom] = useState(true);

  // Counts applied timer broadcasts. A re-sync fetch is only applied if this
  // has not moved while it was in flight - a broadcast that arrived in the
  // meantime is newer than whatever the fetch read.
  const broadcastCount = useRef(0);

  // Same guard as the dashboard: only redirect once the session check has
  // finished, and never when the auth server was simply unreachable.
  useEffect(() => {
    if (!loading && !user && !error) {
      router.replace("/login");
    }
  }, [loading, user, error, router]);

  useEffect(() => {
    if (loading || !user || !roomId) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      const result = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}`);

      if (cancelled) {
        return;
      }

      if (result.ok) {
        setRoom(result.data.room);
        setRoomError(null);
      } else if (result.status === 401) {
        await refreshUser();
        router.replace("/login");
        return;
      } else {
        const safe = result.status === 400 || result.status === 404;
        setRoomError(safe && result.data.message ? result.data.message : GENERIC_FAILURE);
      }

      setLoadingRoom(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, user, roomId, refreshUser, router]);

  // A timer broadcast carries only the timer, so it is merged into the room
  // already held here; the same `room` state is what the initial fetch and
  // every successful timer action (a full room) write to. Anything that is
  // not a well-formed timer state is ignored rather than displayed.
  const handleTimerBroadcast = useCallback((payload) => {
    const next = payload ? payload.timerState : null;

    if (!isTimerState(next)) {
      return;
    }

    broadcastCount.current += 1;
    setRoom((current) => (current ? { ...current, timerState: next } : current));
  }, []);

  // Late-joiner boundary. The first fetch happens before the room channel
  // exists, so a timer change between that read and the channel becoming
  // SUBSCRIBED would be in neither. RoomMembers calls this once the channel
  // is live (and again after any reconnect): one more read of the canonical
  // room, after which every later change arrives as a broadcast. Not
  // polling - it runs only on (re)subscription.
  const syncRoom = useCallback(async () => {
    const seen = broadcastCount.current;
    const result = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}`);

    if (result.ok && broadcastCount.current === seen) {
      setRoom(result.data.room);
    } else if (result.status === 401) {
      await refreshUser();
      router.replace("/login");
    }
    // Other failures are left alone: the state shown is still the last
    // canonical one and the live channel is up.
  }, [roomId, refreshUser, router]);

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
    <div className="mx-auto w-full max-w-md p-8" data-testid="room-page">
      {loadingRoom ? (
        <p data-testid="room-state">Loading room...</p>
      ) : roomError ? (
        <p className="text-red-600" data-testid="room-state">
          {roomError}
        </p>
      ) : room ? (
        <>
          <h1 className="text-2xl font-bold" data-testid="room-name">
            {room.name}
          </h1>
          <p
            className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"
            data-testid="room-subject"
          >
            {room.subject}
          </p>

          <RoomTimer
            roomId={room.id}
            timerState={room.timerState}
            canControl={room.members.some((member) => member.id === user.id)}
            onRoomUpdate={setRoom}
          />

          <RoomMembers
            room={room}
            currentUserId={user.id}
            onTimerUpdate={handleTimerBroadcast}
            onSubscribed={syncRoom}
          />
        </>
      ) : null}

      <p className="mt-8 text-sm">
        <Link href="/dashboard" className="underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
