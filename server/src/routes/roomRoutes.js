const express = require("express");

const {
  createRoom,
  getRoom,
  joinRoom,
  startTimer,
  pauseTimer,
  resetTimer,
} = require("../controllers/roomController");
const requireAuth = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", requireAuth, createRoom);
router.post("/:id/join", requireAuth, joinRoom);
router.get("/:id", requireAuth, getRoom);

// Timer actions. No request body is read; the server owns the timer state.
router.post("/:id/timer/start", requireAuth, startTimer);
router.post("/:id/timer/pause", requireAuth, pauseTimer);
router.post("/:id/timer/reset", requireAuth, resetTimer);

module.exports = router;
