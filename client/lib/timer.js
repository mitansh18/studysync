// Pure helpers for displaying the room's shared Pomodoro timer.
//
// The canonical state is always the server's { status, startedAt,
// durationSeconds }. Nothing here mutates or re-interprets it; the display
// is derived from it plus a clock reading, so a ticking interval never
// becomes a second source of truth and cannot drift.

const STATUSES = ["idle", "running", "paused"];

// Guards a timer state that arrived over the network (initial fetch, an API
// response, or a realtime broadcast) before it is trusted for display.
export function isTimerState(value) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const { status, startedAt, durationSeconds } = value;

  if (!STATUSES.includes(status)) {
    return false;
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1) {
    return false;
  }
  if (status === "running") {
    return typeof startedAt === "string" && !Number.isNaN(Date.parse(startedAt));
  }
  return startedAt === null;
}

// Seconds left as of `now` (a Date.now() reading). Idle and paused timers
// simply show their durationSeconds; a running one counts down from
// startedAt. Never negative, and never more than the segment length even if
// the two clocks disagree.
export function getRemainingSeconds(timerState, now) {
  if (timerState.status !== "running") {
    return timerState.durationSeconds;
  }

  const elapsed = Math.floor(
    (now - new Date(timerState.startedAt).getTime()) / 1000
  );

  return Math.max(0, timerState.durationSeconds - Math.max(0, elapsed));
}

// MM:SS. Minutes are padded too so the text keeps one width while ticking.
export function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
