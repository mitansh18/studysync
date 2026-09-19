const Note = require("../models/Note");
const Room = require("../models/Room");

// Same checks as the room controller keeps for its own routes, repeated
// here rather than shared so the two controllers stay independent files.
function isObjectId(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);
}

function isMember(room, userId) {
  return room.members.some((member) => member._id.equals(userId));
}

// Validates the id, loads the room and checks membership. Returns { room }
// or { status, message } for the caller to send. Notes are room content, so
// unlike the room's metadata they are members-only to read as well as write.
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

// The only shape of notes that may be sent to a client. A room that has
// never been saved has no document and reads as version 0 with no
// timestamp, which is what a client should treat as "nothing yet".
function toNotesResponse(note) {
  if (!note) {
    return { text: "", version: 0, updatedAt: null };
  }

  return {
    text: note.text,
    version: note.version,
    updatedAt: note.updatedAt,
  };
}

async function getNotes(req, res, next) {
  try {
    const loaded = await loadRoomForMember(req.params.id, req.user._id);
    if (!loaded.room) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    // A read never creates the document.
    const note = await Note.findOne({ roomId: loaded.room._id });

    return res.status(200).json({ notes: toNotesResponse(note) });
  } catch (error) {
    return next(error);
  }
}

// Last-writer-wins on the whole text, by design (one shared textarea). The
// text and the version bump go to MongoDB in a single upsert, so every
// successful save gets its own consecutive version and the stored text is
// always the one that committed last.
async function putNotes(req, res, next) {
  try {
    const loaded = await loadRoomForMember(req.params.id, req.user._id);
    if (!loaded.room) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    // Only `text` is read from the body, and only as an actual string:
    // numbers, booleans, arrays, objects and null are refused rather than
    // coerced. roomId comes from the URL and updatedBy from the session.
    const body = req.body || {};
    const { text } = body;

    if (typeof text !== "string") {
      return res.status(400).json({ message: "Notes text must be a string" });
    }
    if (text.length > Note.MAX_TEXT_LENGTH) {
      return res.status(400).json({
        message: `Notes text must be at most ${Note.MAX_TEXT_LENGTH} characters`,
      });
    }

    const note = await saveNotes(loaded.room._id, text, req.user._id);

    return res.status(200).json({ notes: toNotesResponse(note) });
  } catch (error) {
    return next(error);
  }
}

// Two first saves for the same room can race on the upsert: MongoDB
// inserts one and rejects the other with a duplicate-key error against the
// unique roomId index. That loser is simply retried, at which point the
// document exists and its write becomes an ordinary update.
async function saveNotes(roomId, text, userId) {
  const write = () =>
    Note.findOneAndUpdate(
      { roomId },
      { $set: { text, updatedBy: userId }, $inc: { version: 1 } },
      { upsert: true, returnDocument: "after", runValidators: true }
    );

  try {
    return await write();
  } catch (error) {
    if (error.code === 11000) {
      return write();
    }
    throw error;
  }
}

module.exports = { getNotes, putNotes };
