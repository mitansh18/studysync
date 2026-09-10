const express = require("express");

const {
  createRoom,
  getRoom,
  joinRoom,
} = require("../controllers/roomController");
const requireAuth = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", requireAuth, createRoom);
router.post("/:id/join", requireAuth, joinRoom);
router.get("/:id", requireAuth, getRoom);

module.exports = router;
