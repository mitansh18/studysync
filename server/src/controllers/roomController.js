const Room = require("../models/Room");
const { broadcastTimerUpdate } = require("../services/realtime");
const {
  recordStudySession,
  SessionRecordingError,
} = require("../services/sessionRecording");

// Mongoose's isValid() also accepts any 12-character string, which would let
// "abcdefghijkl" through as an id. A 24-char hex check is what actually
// matches an ObjectId as it appears in a URL.
function isObjectId(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

// The only shape of a room that may be sent to a client. Members carry an
// id and a display name and nothing else - the populate below selects just
// `name`, so no email or credential field can leak through here.
function toRoomResponse(room) {
  return {
    id: room._id.toString(),
    name: room.name,
    subject: room.subject,
    hostId: room.hostId.toString(),
    members: room.members.map((member) => ({
      id: member._id.toString(),
      name: member.name,
    })),
    status: room.status,
    timerState: {
      status: room.timerState.status,
      startedAt: room.timerState.startedAt,
      durationSeconds: room.timerState.durationSeconds,
    },
    timerVersion: room.timerVersion,
    createdAt: room.createdAt,
  };
}

async function createRoom(req, res, next) {
  try {
    const body = req.body || {};

    const name = readString(body.name);
    const subject = readString(body.subject);

    if (!name) {
      return res.status(400).json({ message: "Room name is required" });
    }
    if (!subject) {
      return res.status(400).json({ message: "Room subject is required" });
    }

    // Only name and subject are taken from the request. Host, membership,
    // status and timer are server-derived, so a client cannot claim to be
    // another host or start a room in an arbitrary state.
    const room = await Room.create({
      name,
      subject,
      hostId: req.user._id,
      members: [req.user._id],
    });

    await room.populate("members", "name");

    return res.status(201).json({
      message: "Room created successfully",
      room: toRoomResponse(room),
    });
  } catch (error) {
    return next(error);
  }
}

async function getRoom(req, res, next) {
  try {
    const { id } = req.params;

    // Checked before querying so Mongoose never raises a CastError.
    if (!isObjectId(id)) {
      return res.status(400).json({ message: "Invalid room ID" });
    }

    const room = await Room.findById(id).populate("members", "name");

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    return res.status(200).json({ room: toRoomResponse(room) });
  } catch (error) {
    return next(error);
  }
}

async function joinRoom(req, res, next) {
  try {
    const { id } = req.params;

    // Checked before querying so Mongoose never raises a CastError.
    if (!isObjectId(id)) {
      return res.status(400).json({ message: "Invalid room ID" });
    }

    // $addToSet is atomic, so concurrent joins cannot produce a duplicate
    // member. It also makes a repeat join a no-op rather than an error.
    // Only `members` is written; every other field is left untouched.
    //
    // `status: "active"` is what keeps membership and recorded history in
    // agreement: joining a room whose session has already been recorded would
    // leave a member who is not a participant of it.
    const room = await Room.findOneAndUpdate(
      { _id: id, status: "active" },
      { $addToSet: { members: req.user._id } },
      { new: true }
    ).populate("members", "name");

    if (!room) {
      // The filter can miss for two different reasons; say which.
      const existing = await Room.findById(id);

      if (!existing) {
        return res.status(404).json({ message: "Room not found" });
      }
      return res.status(409).json({ message: ENDED_MESSAGE });
    }

    return res.status(200).json({
      message: "Joined room successfully",
      room: toRoomResponse(room),
    });
  } catch (error) {
    return next(error);
  }
}

// ---------------------------------------------------------------------------
// Timer API (Stage 2.2)
//
// Clients request an action; the server decides the resulting state. Nothing
// in req.body is read by any timer handler, so a client cannot supply
// status, startedAt, durationSeconds or a "remaining" value.
//
// Every write is a compare-and-swap in the same findOneAndUpdate style as
// joinRoom: the filter asserts the timer state that was just read, and the
// update replaces the whole timerState object with runValidators on, which
// is the one update form the Stage 2.1 invariants are enforced for. Two
// racing requests therefore cannot both succeed - the second one's filter no
// longer matches and it is answered with a 409 instead of overwriting.
// ---------------------------------------------------------------------------

const DEFAULT_TIMER_STATE = Object.freeze({
  status: "idle",
  startedAt: null,
  durationSeconds: Room.DEFAULT_TIMER_DURATION_SECONDS,
});

// An ended room is history: its study time is already recorded in SQL, so
// letting the timer run again (or the notes change, or someone join) would
// leave MongoDB saying something the recorded session does not. Reads stay
// open; writes are refused with this.
const ENDED_MESSAGE = "This session has ended";

function isMember(room, userId) {
  return room.members.some((member) => member._id.equals(userId));
}

// Shared entry for the timer handlers: validates the id, loads the room and
// checks membership. Returns { room } or { status, message } for the caller
// to send. Presence is deliberately not consulted - being in the members
// list is what grants timer control, not being currently connected.
async function loadRoomForMember(id, userId) {
  if (!isObjectId(id)) {
    return { status: 400, message: "Invalid room ID" };
  }

  const room = await Room.findById(id);

  if (!room) {
    return { status: 404, message: "Room not found" };
  }
  if (!isMember(room, userId)) {
    return { status: 403, message: "You are not a member of this room" };
  }

  return { room };
}

// Applies `nextTimerState` only if the room's timer still matches
// `expectedTimer` (a partial of timerState fields). `members` is part of the
// filter as well, so the write itself cannot land for a non-member.
//
// `extra` carries the study-time accounting that belongs to the very same
// transition ({ set, inc }, Stage 4.2). It rides in this one update rather
// than a second write, so the timer state and what it says about study time
// can never disagree, and the compare-and-swap protects both.
function swapTimerState(roomId, userId, expectedTimer, nextTimerState, extra = {}) {
  // `status: "active"` closes the window between reading a room and writing
  // it: a session that ends in between makes this write miss rather than
  // restart a timer on a finished session.
  const filter = { _id: roomId, members: userId, status: "active" };
  for (const [field, value] of Object.entries(expectedTimer)) {
    filter[`timerState.${field}`] = value;
  }

  // The version bump rides in the same single update as the state change,
  // so there is never a moment where one has happened without the other.
  return Room.findOneAndUpdate(
    filter,
    {
      $set: { timerState: nextTimerState, ...extra.set },
      $inc: { timerVersion: 1, ...extra.inc },
    },
    { returnDocument: "after", runValidators: true }
  ).populate("members", "name");
}

// Every successful timer write ends here: the room is serialized once, the
// same timerState object the caller gets is broadcast to the room channel,
// and only then does the response go out. The broadcast runs strictly after
// the MongoDB write and never affects the response - a failure is logged
// inside the helper and the client still receives the canonical state.
async function sendTimerResult(res, message, room) {
  const payload = toRoomResponse(room);

  await broadcastTimerUpdate(payload.id, payload.timerState, payload.timerVersion);

  return res.status(200).json({ message, room: payload });
}

// A swap that matched nothing means the room vanished or another request
// changed the timer between the read and the write. Re-read to say which.
async function timerConflict(res, roomId) {
  const room = await Room.findById(roomId);

  if (!room) {
    return res.status(404).json({ message: "Room not found" });
  }
  if (room.status !== "active") {
    return res.status(409).json({ message: ENDED_MESSAGE });
  }

  return res.status(409).json({
    message:
      room.timerState.status === "running"
        ? "Timer is already running"
        : "Timer state changed, please try again",
  });
}

// What a running stretch becomes when it stops, and what it contributed to the
// room's study time. Pulled out of pauseTimer so ending a session can settle a
// running timer exactly the way pausing does, rather than keeping a second
// copy of this arithmetic. Behaviour is unchanged: elapsed is floored and
// clamped at zero, a stretch with time left becomes `paused` holding the
// remainder, and one that ran out returns to the idle default.
function settleRunningTimer(timerState, nowMs = Date.now()) {
  const { startedAt, durationSeconds } = timerState;

  // Both timestamps are this server's, but a clock stepping backwards (or a
  // second instance with a skewed clock) could make elapsed negative, which
  // would grant more time than the segment had. Clamp at zero.
  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - startedAt.getTime()) / 1000)
  );
  const remainingSeconds = durationSeconds - elapsedSeconds;

  return {
    nextTimerState:
      remainingSeconds > 0
        ? { status: "paused", startedAt: null, durationSeconds: remainingSeconds }
        : { ...DEFAULT_TIMER_STATE },
    // Never more than the stretch was given: a timer left running for hours,
    // or a clock jump, must not invent study time.
    studiedSeconds: Math.min(elapsedSeconds, durationSeconds),
    expired: remainingSeconds <= 0,
  };
}

// idle -> running, paused -> running. The current durationSeconds is kept:
// for idle it is the configured length, for paused it is what was left, and
// either way it becomes the length of the new running segment measured from
// the server clock. running -> start is refused rather than restarted.
async function startTimer(req, res, next) {
  try {
    const loaded = await loadRoomForMember(req.params.id, req.user._id);
    if (!loaded.room) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    if (loaded.room.status !== "active") {
      return res.status(409).json({ message: ENDED_MESSAGE });
    }

    const { status, durationSeconds } = loaded.room.timerState;

    if (status === "running") {
      return res.status(409).json({ message: "Timer is already running" });
    }

    const room = await swapTimerState(
      loaded.room._id,
      req.user._id,
      { status, durationSeconds },
      { status: "running", startedAt: new Date(), durationSeconds }
    );

    if (!room) {
      return timerConflict(res, loaded.room._id);
    }

    return sendTimerResult(res, "Timer started", room);
  } catch (error) {
    return next(error);
  }
}

// running -> paused. Remaining time is computed here from the server clock
// and the stored start; nothing about elapsed or remaining time is taken
// from the client. Elapsed is floored so a pause never costs a partial
// second the users have not yet lived through.
//
// If the countdown has already reached zero by the time the pause arrives,
// the timer is returned to the idle default instead of being stored as
// paused with 0 seconds - Stage 2.1 made a zero duration invalid on purpose,
// because a paused timer with nothing left has nothing to resume.
async function pauseTimer(req, res, next) {
  try {
    const loaded = await loadRoomForMember(req.params.id, req.user._id);
    if (!loaded.room) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    if (loaded.room.status !== "active") {
      return res.status(409).json({ message: ENDED_MESSAGE });
    }

    const { status, startedAt, durationSeconds } = loaded.room.timerState;

    if (status !== "running") {
      return res.status(409).json({ message: "Timer is not running" });
    }

    // Both timestamps are this server's, but a clock stepping backwards (or
    // a second instance with a skewed clock) could make elapsed negative,
    // which would grant more time than the segment had. Clamp at zero.
    // Study-time accounting (Stage 4.2): the stretch that just ended is added
    // to the room's total for this segment. The expired case accumulates too -
    // the timer is shown as idle again, but the full stretch was studied, and
    // that is what later gets recorded.
    const settled = settleRunningTimer(loaded.room.timerState);
    const studiedSeconds = loaded.room.studiedSeconds + settled.studiedSeconds;

    // startedAt in the filter distinguishes this running segment from one
    // that a concurrent reset+start could have produced in the meantime.
    const room = await swapTimerState(
      loaded.room._id,
      req.user._id,
      { status: "running", startedAt },
      settled.nextTimerState,
      { set: { studiedSeconds } }
    );

    if (!room) {
      return timerConflict(res, loaded.room._id);
    }

    return sendTimerResult(
      res,
      settled.expired ? "Timer expired" : "Timer paused",
      room
    );
  } catch (error) {
    return next(error);
  }
}

// Any state -> idle default. The reset outcome does not depend on what the
// timer was doing, so no precondition is needed: whichever of two racing
// resets lands last leaves the same state.
async function resetTimer(req, res, next) {
  try {
    const loaded = await loadRoomForMember(req.params.id, req.user._id);
    if (!loaded.room) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    if (loaded.room.status !== "active") {
      return res.status(409).json({ message: ENDED_MESSAGE });
    }

    // Reset means "start over", so the study time accumulated so far stops
    // belonging to anything that can still be recorded, and the room moves on
    // to its next study segment (Stage 4.2). Visible timer behaviour is
    // unchanged - these two fields are internal.
    const room = await swapTimerState(
      loaded.room._id,
      req.user._id,
      {},
      { ...DEFAULT_TIMER_STATE },
      { set: { studiedSeconds: 0 }, inc: { sessionSegment: 1 } }
    );

    if (!room) {
      return timerConflict(res, loaded.room._id);
    }

    return sendTimerResult(res, "Timer reset", room);
  } catch (error) {
    return next(error);
  }
}

// ---------------------------------------------------------------------------
// Manual End Session (Stage 4.3)
//
// Ending a session is the one operation that spans both databases, and there
// is no transaction across them, so the order is chosen so that the only way
// for it to fail is "not ended yet":
//
//   freeze a running timer  ->  record the segment in PostgreSQL  ->  only
//   then let MongoDB say the room has ended, settle the timer and move on to
//   the next segment, all in one conditional update.
//
// If the recording fails, the room stays active and the call can simply be
// repeated. If the process dies after the recording commits, repeating it is
// also safe: Stage 4.2 is idempotent per (room, segment, participant), so the
// retry writes no second row and goes on to finalise.
// ---------------------------------------------------------------------------

function loadRoomWithMembers(roomId) {
  return Room.findById(roomId).populate("members", "name");
}

// The one response shape /end answers with, whichever path produced it.
function sendEndResult(res, message, room, session) {
  return res.status(200).json({
    message,
    room: toRoomResponse(room),
    session,
  });
}

const ALREADY_ENDED_SESSION = Object.freeze({
  ended: true,
  alreadyEnded: true,
  recorded: false,
});

async function endSession(req, res, next) {
  try {
    const loaded = await loadRoomForMember(req.params.id, req.user._id);
    if (!loaded.room) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    let room = loaded.room;

    // Already ended. Nothing is recorded here on purpose: the segment that was
    // ended is already in SQL, and recording again would write the fresh empty
    // segment the room moved on to. Ending is terminal, so a retry or a second
    // member pressing the button gets the same answer as the call that won.
    if (room.status !== "active") {
      return sendEndResult(
        res,
        "Session already ended",
        await loadRoomWithMembers(room._id),
        ALREADY_ENDED_SESSION
      );
    }

    // 1. Freeze a running timer, exactly as pausing would. This makes the
    // duration about to be recorded a stored number rather than a reading of
    // the clock: the same on every retry, and already safe in MongoDB even if
    // the SQL write below fails. The room is NOT marked ended yet.
    if (room.timerState.status === "running") {
      const settled = settleRunningTimer(room.timerState);
      const frozen = await swapTimerState(
        room._id,
        req.user._id,
        { status: "running", startedAt: room.timerState.startedAt },
        settled.nextTimerState,
        { set: { studiedSeconds: room.studiedSeconds + settled.studiedSeconds } }
      );

      // A concurrent pause or expiry settled it first - the time is accounted
      // for either way, so continue from whatever MongoDB now holds.
      room = frozen || (await loadRoomWithMembers(room._id));

      if (!room) {
        return res.status(404).json({ message: "Room not found" });
      }
      if (room.status !== "active") {
        return sendEndResult(res, "Session already ended", room, ALREADY_ENDED_SESSION);
      }
    }

    // 2. PostgreSQL first. Every participant, the subject and the duration come
    // from MongoDB inside the service; this request body is never read.
    let recording;
    try {
      recording = await recordStudySession(room._id.toString());
    } catch (error) {
      if (error instanceof SessionRecordingError) {
        return res.status(error.status).json({ message: error.message });
      }
      // Anything else (including a Prisma failure) goes to the error handler,
      // which logs it server-side and answers with a generic 500.
      return next(error);
    }

    // 3. One conditional update ends the room, settles the timer and starts the
    // next segment. The filter is what makes concurrency safe: `status` lets
    // exactly one of two simultaneous enders through, `sessionSegment` refuses
    // to end a segment other than the one just recorded (a reset in between
    // moves it on), and the member count refuses to end a room someone joined
    // after the recording took its snapshot.
    const finalised = await Room.findOneAndUpdate(
      {
        _id: room._id,
        status: "active",
        sessionSegment: recording.segment,
        members: { $size: recording.participantCount },
      },
      {
        $set: {
          status: "ended",
          timerState: { ...DEFAULT_TIMER_STATE },
          studiedSeconds: 0,
        },
        $inc: { timerVersion: 1, sessionSegment: 1 },
      },
      { returnDocument: "after", runValidators: true }
    ).populate("members", "name");

    if (!finalised) {
      const current = await loadRoomWithMembers(room._id);

      if (!current) {
        return res.status(404).json({ message: "Room not found" });
      }
      // Another end request won the race; its answer is this one's answer.
      if (current.status !== "active") {
        return sendEndResult(res, "Session already ended", current, ALREADY_ENDED_SESSION);
      }
      // A reset moved the segment on, or a member joined, so what was just
      // recorded is no longer what would be ended. Repeating the request
      // records the current segment (including any new member - the unique key
      // is per participant) and then finalises.
      return res.status(409).json({
        message: "Room changed while ending the session, please try again",
      });
    }

    // The timer state really did change, so the room's channel is told what it
    // is now through the same "timer" event every timer write already sends -
    // the canonical idle state a reset sends too. No new event, no new payload.
    const payload = toRoomResponse(finalised);
    await broadcastTimerUpdate(payload.id, payload.timerState, payload.timerVersion);

    return sendEndResult(res, "Session ended", finalised, {
      ended: true,
      alreadyEnded: false,
      recorded: true,
      alreadyRecorded: recording.alreadyRecorded,
      segment: recording.segment,
      participantCount: recording.participantCount,
      durationMinutes: recording.durationMinutes,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createRoom,
  getRoom,
  joinRoom,
  startTimer,
  pauseTimer,
  resetTimer,
  endSession,
};
