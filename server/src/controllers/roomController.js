const Room = require("../models/Room");

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

module.exports = { createRoom, getRoom, joinRoom };
