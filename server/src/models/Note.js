const mongoose = require("mongoose");

// One shared notes document per room, created on the first save rather than
// with the room, so existing rooms need nothing. Until then a room reads as
// { text: "", version: 0 }.
//
// Kept out of the Room document on purpose: the text can be large and must
// not ride along on every room read, and it has its own version counter -
// the notes counterpart of Room.timerVersion, bumped by $inc in the same
// atomic write as the text so clients can drop stale broadcasts later.
const MAX_TEXT_LENGTH = 20000;

const noteSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      // The unique index is what guarantees a single document per room,
      // even under concurrent first saves.
      unique: true,
    },
    // Whatever the user typed, exactly: whitespace is content, so no trim.
    text: {
      type: String,
      default: "",
      maxlength: MAX_TEXT_LENGTH,
    },
    version: {
      type: Number,
      default: 0,
      min: 0,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  // Supplies createdAt and updatedAt, matching the other models.
  { timestamps: true }
);

const Note = mongoose.model("Note", noteSchema);

Note.MAX_TEXT_LENGTH = MAX_TEXT_LENGTH;

module.exports = Note;
