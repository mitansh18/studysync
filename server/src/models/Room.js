const mongoose = require("mongoose");

// Embedded rather than a separate collection: the timer belongs to exactly
// one room and is always read with it. _id is off because a subdocument
// that is never addressed on its own does not need one.
// Stage 2 owns the start/pause/reset behaviour; this only holds the shape.
const timerStateSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ["idle", "running", "paused"],
      default: "idle",
    },
    // Null until the timer is first started.
    startedAt: {
      type: Date,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: 1500,
      min: 0,
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

module.exports = mongoose.model("Room", roomSchema);
