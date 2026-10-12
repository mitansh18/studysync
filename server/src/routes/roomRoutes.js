const express = require("express");

const {
  createRoom,
  getRoom,
  joinRoom,
  startTimer,
  pauseTimer,
  resetTimer,
  endSession,
} = require("../controllers/roomController");
const { getNotes, putNotes } = require("../controllers/notesController");
const requireAuth = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", requireAuth, createRoom);
router.post("/:id/join", requireAuth, joinRoom);
router.get("/:id", requireAuth, getRoom);

// Timer actions. No request body is read; the server owns the timer state.
router.post("/:id/timer/start", requireAuth, startTimer);
router.post("/:id/timer/pause", requireAuth, pauseTimer);
router.post("/:id/timer/reset", requireAuth, resetTimer);

// Ends the room's study session: records it to SQL, then marks the room
// ended. Members only; no request body is read (Stage 4.3).
router.post("/:id/end", requireAuth, endSession);

// Shared notes. Members only, for reading as well as writing.
router.get("/:id/notes", requireAuth, getNotes);
router.put("/:id/notes", requireAuth, putNotes);

module.exports = router;
