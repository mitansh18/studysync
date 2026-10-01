const Room = require("../models/Room");
const User = require("../models/User");
const { getPrisma } = require("../config/sql");

// Records a finished study segment as durable SQL history (Stage 4.2).
//
// MongoDB is authoritative for everything this writes: who took part, what
// the subject was and how long was actually studied are all read from the
// room and its members, never supplied by a caller. The only thing a caller
// says is which room is being finalized.
//
// PostgreSQL holds the history. The pair (room, segment) identifies one
// finished segment, so recording the same segment again - a retry, a second
// caller, a process that crashed after committing - adds nothing, because the
// unique index refuses a second row for the same participant and segment.
//
// Nothing here is reachable over HTTP yet: Stage 4.3 (manual end) and Stage
// 4.4 (natural timer completion) are the callers.

const SECONDS_PER_MINUTE = 60;

// Prisma codes for "two transactions collided": the recording is idempotent,
// so simply trying again is correct.
const RETRYABLE_PRISMA_CODES = new Set(["P2002", "P2034"]);

// Interactive transactions default to a 5 s budget; a large room doing one
// upsert per participant over a pooled connection deserves more room than
// that before it is called a failure.
const TRANSACTION_TIMEOUT_MS = 20000;
const TRANSACTION_MAX_WAIT_MS = 10000;

// Carries the status a route should answer with, in the shape the existing
// error handler already understands (status < 500 keeps its message).
class SessionRecordingError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SessionRecordingError";
    this.status = status;
  }
}

function isObjectId(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);
}

// Whole minutes, floored. Flooring is deliberate: it can only ever understate
// study time, never claim time that was not studied, and a session shorter
// than a minute is recorded as 0 rather than rounded up to 1. The column
// allows 0 (CHECK duration_minutes >= 0); the accounting itself stays in
// seconds right up to this boundary.
function toDurationMinutes(studiedSeconds) {
  return Math.floor(studiedSeconds / SECONDS_PER_MINUTE);
}

// How long this segment has actually been studied, from canonical state only.
//
//   idle / paused   what the room has already accumulated
//   running         that, plus the stretch running since startedAt
//
// The live stretch is clamped to the length it was given and to zero, so a
// timer left running for hours, or a clock that steps backwards, cannot
// invent study time or produce a negative one.
function studiedSecondsFor(room, now) {
  const stored = room.studiedSeconds;

  if (!Number.isInteger(stored) || stored < 0) {
    throw new SessionRecordingError(422, "Room study time is invalid");
  }

  const timerState = room.timerState || {};
  const { status, startedAt, durationSeconds } = timerState;

  if (status !== "running") {
    return stored;
  }

  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
    throw new SessionRecordingError(422, "Timer state is invalid");
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1) {
    throw new SessionRecordingError(422, "Timer state is invalid");
  }

  const elapsedSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
  const countedSeconds = Math.min(Math.max(0, elapsedSeconds), durationSeconds);

  return stored + countedSeconds;
}

// The participants, read from MongoDB. Sorted by id so two concurrent
// recordings touch the same rows in the same order and queue instead of
// deadlocking.
async function loadParticipants(room) {
  const memberIds = [...new Set(room.members.map((member) => member.toString()))];

  if (memberIds.length === 0) {
    throw new SessionRecordingError(422, "Room has no members to record");
  }

  const users = await User.find({ _id: { $in: memberIds } }).select("name email");

  // A member the room still lists but MongoDB no longer has. Inventing a SQL
  // identity for them would put a participant in the history who cannot be
  // explained, and silently dropping them would record a session that misses
  // someone - so nothing is recorded at all.
  if (users.length !== memberIds.length) {
    throw new SessionRecordingError(
      422,
      "A room member no longer exists, so this session was not recorded"
    );
  }

  return users
    .map((user) => ({
      id: user._id.toString(),
      name: user.name,
      email: user.email ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// One SQL transaction: every participant's mirror row is brought up to date
// and every session row is inserted together, so a room never ends up with
// half its participants recorded. Rows that another transaction already wrote
// are skipped rather than failing the whole attempt, which is what makes a
// retry or a second caller a no-op instead of an error.
async function writeHistory(prisma, participants, row) {
  return prisma.$transaction(
    async (tx) => {
      for (const participant of participants) {
        await tx.user.upsert({
          where: { id: participant.id },
          // MongoDB is authoritative, so a changed name or email is refreshed
          // here. No credential field is ever mirrored.
          update: { name: participant.name, email: participant.email },
          create: {
            id: participant.id,
            name: participant.name,
            email: participant.email,
          },
        });
      }

      const result = await tx.studySession.createMany({
        data: participants.map((participant) => ({
          userId: participant.id,
          roomId: row.roomId,
          segment: row.segment,
          subject: row.subject,
          durationMinutes: row.durationMinutes,
          date: row.date,
        })),
        skipDuplicates: true,
      });

      return result.count;
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS }
  );
}

/**
 * Records the room's current study segment.
 *
 * Reads MongoDB for the room, its members and its timer, writes PostgreSQL in
 * one transaction, and touches MongoDB not at all - so there is no moment
 * where MongoDB claims a session was recorded that PostgreSQL does not have.
 * A new segment begins when the timer is reset (Room.sessionSegment).
 *
 * @param {string} roomId MongoDB room _id.
 * @returns {Promise<{
 *   roomId: string, segment: number, subject: string,
 *   studiedSeconds: number, durationMinutes: number, date: Date,
 *   participantCount: number, created: number, skipped: number,
 *   alreadyRecorded: boolean
 * }>} created counts the rows this call inserted; skipped the ones that were
 * already there. alreadyRecorded means this call inserted nothing because the
 * segment had been recorded before.
 * @throws {SessionRecordingError} 400 invalid id, 404 unknown room,
 * 422 unusable room state (no members, missing member, invalid timer).
 */
async function recordStudySession(roomId) {
  const id = roomId === undefined || roomId === null ? "" : String(roomId);

  if (!isObjectId(id)) {
    throw new SessionRecordingError(400, "Invalid room ID");
  }

  const room = await Room.findById(id);

  if (!room) {
    throw new SessionRecordingError(404, "Room not found");
  }
  if (!Number.isInteger(room.sessionSegment) || room.sessionSegment < 0) {
    throw new SessionRecordingError(422, "Room session segment is invalid");
  }

  const participants = await loadParticipants(room);

  // One reading of the clock for the whole recording: every row of a segment
  // carries the same instant, stored as UTC (timestamptz).
  const now = new Date();
  const studiedSeconds = studiedSecondsFor(room, now);

  const row = {
    roomId: room._id.toString(),
    segment: room.sessionSegment,
    subject: room.subject,
    durationMinutes: toDurationMinutes(studiedSeconds),
    date: now,
  };

  const prisma = getPrisma();

  let created;
  for (let attempt = 1; ; attempt += 1) {
    try {
      created = await writeHistory(prisma, participants, row);
      break;
    } catch (error) {
      // A collision with a concurrent recording of the same segment. Trying
      // again is safe: the second attempt finds the rows already there.
      if (attempt < 2 && error && RETRYABLE_PRISMA_CODES.has(error.code)) {
        continue;
      }
      throw error;
    }
  }

  return {
    roomId: row.roomId,
    segment: row.segment,
    subject: row.subject,
    studiedSeconds,
    durationMinutes: row.durationMinutes,
    date: row.date,
    participantCount: participants.length,
    created,
    skipped: participants.length - created,
    alreadyRecorded: created === 0,
  };
}

module.exports = {
  recordStudySession,
  SessionRecordingError,
  // Exported for the accounting tests; not part of the service's API.
  studiedSecondsFor,
  toDurationMinutes,
};
