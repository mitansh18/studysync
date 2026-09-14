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

// The server always sends timerVersion; a room without one is treated as
// version 0 rather than breaking the comparisons below.
function versionOf(room) {
  return room && Number.isInteger(room.timerVersion) ? room.timerVersion : 0;
}

export default function RoomPage() {
  const { user, loading, error, refreshUser } = useAuth();
  const router = useRouter();
  const params = useParams();
  const roomId = typeof params.id === "string" ? params.id : "";

  const [room, setRoom] = useState(null);
  const [roomError, setRoomError] = useState(null);
  const [loadingRoom, setLoadingRoom] = useState(true);

  // Counts applied timer broadcasts. An HTTP room response is only applied
  // if this has not moved while the request was in flight - a broadcast that
  // arrived in the meantime is newer than whatever the response carries.
  const broadcastCount = useRef(0);

  // The room this page is showing right now. The page instance survives
  // navigating from one room to another, so a slow response for the old
  // room can arrive after the switch and must be ignored.
  const currentRoomId = useRef(roomId);
  useEffect(() => {
    currentRoomId.current = roomId;
  }, [roomId]);

  // Highest timerVersion applied so far. MongoDB assigns the version in the
  // same write as the state, so anything not newer than this is old news no
  // matter when it arrives - which is what keeps a passive tab right when
  // two broadcasts are delivered in the wrong order. Distinct from
  // broadcastCount above, which decides whether an HTTP response was
  // overtaken while in flight.
  const appliedVersion = useRef(0);

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
        appliedVersion.current = versionOf(result.data.room);
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
    const version = payload ? payload.timerVersion : null;

    if (!isTimerState(next) || !Number.isInteger(version)) {
      return;
    }

    // Equal or older than what is shown: a duplicate or a late delivery.
    if (version <= appliedVersion.current) {
      return;
    }

    appliedVersion.current = version;
    broadcastCount.current += 1;
    setRoom((current) =>
      current ? { ...current, timerState: next, timerVersion: version } : current
    );
  }, []);

  // Every HTTP room response other than the initial load goes through this
  // pair: take a marker before the request, apply only if no broadcast
  // arrived since (that broadcast is newer) and only if the response is
  // for the room still on screen. Timer action responses and the 409
  // re-fetch in RoomTimer use it too, so no path can put a stale room
  // over a newer one.
  const beginRoomUpdate = useCallback(() => broadcastCount.current, []);

  const applyRoomUpdate = useCallback((nextRoom, seen) => {
    if (broadcastCount.current !== seen) {
      return;
    }
    if (!nextRoom || nextRoom.id !== currentRoomId.current) {
      return;
    }

    // An HTTP room comes straight from MongoDB and the check above already
    // dropped it if a broadcast overtook it, so it cannot be stale: it
    // re-bases the version. That also lets a page recover on its next
    // read if a broadcast ever carried a version MongoDB never issued.
    appliedVersion.current = versionOf(nextRoom);
    setRoom(nextRoom);
  }, []);

  // Late-joiner boundary. The first fetch happens before the room channel
  // exists, so a timer change between that read and the channel becoming
  // SUBSCRIBED would be in neither. RoomMembers calls this once the channel
  // is live (and again after any reconnect): one more read of the canonical
  // room, after which every later change arrives as a broadcast. Not
  // polling - it runs only on (re)subscription.
  const syncRoom = useCallback(async () => {
    const seen = beginRoomUpdate();
    const result = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}`);

    if (result.ok) {
      applyRoomUpdate(result.data.room, seen);
    } else if (result.status === 401) {
      await refreshUser();
      router.replace("/login");
    }
    // Other failures are left alone: the state shown is still the last
    // canonical one and the live channel is up.
  }, [roomId, beginRoomUpdate, applyRoomUpdate, refreshUser, router]);

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
            beginRoomUpdate={beginRoomUpdate}
            applyRoomUpdate={applyRoomUpdate}
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
