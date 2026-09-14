const mongoose = require("mongoose");

// The one Pomodoro length the app knows: applied as the schema default and
// restored by the timer API on reset or expiry. Stage 2 has no per-room
// configuration, so this constant is the single place the number lives.
const DEFAULT_TIMER_DURATION_SECONDS = 1500;

// Embedded rather than a separate collection: the timer belongs to exactly
// one room and is always read with it. _id is off because a subdocument
// that is never addressed on its own does not need one.
//
// This document is the durable source of truth for the room's shared
// Pomodoro timer. Browsers only derive a display from it; they never own
// the countdown. Remaining time is always computable from these fields:
//
//   idle     startedAt is null; durationSeconds is the configured length.
//   running  startedAt is the server-side start; remaining =
//            durationSeconds - (now - startedAt).
//   paused   startedAt is null; durationSeconds holds the seconds that were
//            left at the moment of pausing. Resuming sets startedAt to now
//            and the running formula applies unchanged.
//
// Stage 2 owns the start/pause/reset transitions; this only holds the shape
// and the invariants. The validators below run on save()/create(). An update
// query must replace the whole timerState object with runValidators: true;
// a dotted single-field write ("timerState.status") either bypasses the
// pairing check or fails it, because an update validator cannot see the
// sibling fields.
const timerStateSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ["idle", "running", "paused"],
      default: "idle",
      // The status/startedAt pairing is checked here rather than on
      // startedAt because a required path is validated on every save,
      // whereas a path still holding its default is skipped once the
      // document has been saved.
      validate: {
        validator(value) {
          return value === "running"
            ? this.startedAt instanceof Date
            : this.startedAt === null;
        },
        message: "startedAt must be set while running and null otherwise",
      },
    },
    // Only meaningful while running. Held at null otherwise so a stale
    // start time can never be mistaken for a live one.
    startedAt: {
      type: Date,
      default: null,
    },
    // Whole seconds, always at least 1: a zero, fractional, or infinite
    // duration would make the remaining-time arithmetic meaningless.
    durationSeconds: {
      type: Number,
      required: true,
      default: DEFAULT_TIMER_DURATION_SECONDS,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "durationSeconds must be a whole number of seconds",
      },
    },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Persisted membership only. Who is *currently connected* is a separate
    // concern handled by Supabase Presence later, and must not be stored here.
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    status: {
      type: String,
      required: true,
      enum: ["active", "ended"],
      default: "active",
    },
    timerState: {
      type: timerStateSchema,
      default: () => ({}),
    },
  },
  // Supplies createdAt (and updatedAt), matching the User model.
  { timestamps: true }
);

const Room = mongoose.model("Room", roomSchema);

Room.DEFAULT_TIMER_DURATION_SECONDS = DEFAULT_TIMER_DURATION_SECONDS;

module.exports = Room;
