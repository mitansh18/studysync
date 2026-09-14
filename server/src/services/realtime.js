// Server-side Supabase Realtime broadcasts.
//
// MongoDB is the source of truth for a room's timer; Realtime is only the
// transport that tells connected clients the canonical state changed. A
// broadcast is therefore attempted only after a write has succeeded, and a
// failed broadcast never undoes or fails that write - it is logged, and a
// client can always fetch the canonical state from the API.
//
// No Supabase SDK on the server: supabase-js's own channel.send() falls back
// to this same REST endpoint when it has no socket, so a plain fetch() sends
// an identical message. The publishable (anon) key is enough for the public
// room channels the app uses; the service-role key is never needed here.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Names only - never the values.
const realtimeConfigError = !SUPABASE_URL
  ? "SUPABASE_URL is missing"
  : !SUPABASE_ANON_KEY
    ? "SUPABASE_ANON_KEY is missing"
    : null;

if (realtimeConfigError) {
  console.warn(
    `Realtime broadcasts disabled: ${realtimeConfigError}. Timer API still works; clients will not be notified live.`
  );
}

const BROADCAST_URL = realtimeConfigError
  ? null
  : `${SUPABASE_URL.replace(/\/+$/, "")}/realtime/v1/api/broadcast`;

// A hung Realtime endpoint must not hold the API response hostage.
const BROADCAST_TIMEOUT_MS = 5000;

// Must match channelName() in client/components/RoomMembers.js - presence and
// timer events share the one channel a client opens per room.
function roomChannelName(roomId) {
  return `studysync-room-${roomId}`;
}

// Sends the canonical timer state to everyone subscribed to the room's
// channel as a "timer" broadcast. Resolves true if Supabase accepted the
// message, false otherwise. Never throws.
async function broadcastTimerUpdate(roomId, timerState) {
  if (realtimeConfigError) {
    return false;
  }

  try {
    const response = await fetch(BROADCAST_URL, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            topic: roomChannelName(roomId),
            event: "timer",
            payload: { timerState },
          },
        ],
      }),
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });

    if (response.status !== 202) {
      console.error(
        `Timer broadcast rejected for room ${roomId}: HTTP ${response.status}`
      );
      return false;
    }

    return true;
  } catch (error) {
    // Network failure or timeout. The message never includes the key.
    console.error(`Timer broadcast failed for room ${roomId}: ${error.message}`);
    return false;
  }
}

module.exports = { broadcastTimerUpdate, realtimeConfigError, roomChannelName };
