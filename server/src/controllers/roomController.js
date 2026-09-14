const Room = require("../models/Room");
const { broadcastTimerUpdate } = require("../services/realtime");

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
    const room = await Room.findOneAndUpdate(
      { _id: id },
      { $addToSet: { members: req.user._id } },
      { new: true }
    ).populate("members", "name");

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
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
function swapTimerState(roomId, userId, expectedTimer, nextTimerState) {
  const filter = { _id: roomId, members: userId };
  for (const [field, value] of Object.entries(expectedTimer)) {
    filter[`timerState.${field}`] = value;
  }

  return Room.findOneAndUpdate(
    filter,
    { $set: { timerState: nextTimerState } },
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

  await broadcastTimerUpdate(payload.id, payload.timerState);

  return res.status(200).json({ message, room: payload });
}

// A swap that matched nothing means the room vanished or another request
// changed the timer between the read and the write. Re-read to say which.
async function timerConflict(res, roomId) {
  const room = await Room.findById(roomId);

  if (!room) {
    return res.status(404).json({ message: "Room not found" });
  }

  return res.status(409).json({
    message:
      room.timerState.status === "running"
        ? "Timer is already running"
        : "Timer state changed, please try again",
  });
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

    const { status, startedAt, durationSeconds } = loaded.room.timerState;

    if (status !== "running") {
      return res.status(409).json({ message: "Timer is not running" });
    }

    // Both timestamps are this server's, but a clock stepping backwards (or
    // a second instance with a skewed clock) could make elapsed negative,
    // which would grant more time than the segment had. Clamp at zero.
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt.getTime()) / 1000)
    );
    const remainingSeconds = durationSeconds - elapsedSeconds;

    const nextTimerState =
      remainingSeconds > 0
        ? { status: "paused", startedAt: null, durationSeconds: remainingSeconds }
        : { ...DEFAULT_TIMER_STATE };

    // startedAt in the filter distinguishes this running segment from one
    // that a concurrent reset+start could have produced in the meantime.
    const room = await swapTimerState(
      loaded.room._id,
      req.user._id,
      { status: "running", startedAt },
      nextTimerState
    );

    if (!room) {
      return timerConflict(res, loaded.room._id);
    }

    return sendTimerResult(
      res,
      nextTimerState.status === "paused" ? "Timer paused" : "Timer expired",
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

    const room = await swapTimerState(
      loaded.room._id,
      req.user._id,
      {},
      { ...DEFAULT_TIMER_STATE }
    );

    if (!room) {
      return timerConflict(res, loaded.room._id);
    }

    return sendTimerResult(res, "Timer reset", room);
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
};
