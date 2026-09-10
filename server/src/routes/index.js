const express = require("express");

const {
  getApiRoot,
  getHealth,
  getDbHealth,
} = require("../controllers/healthController");
const authRoutes = require("./authRoutes");
const roomRoutes = require("./roomRoutes");

const router = express.Router();

router.get("/", getApiRoot);
router.get("/health", getHealth);
router.get("/health/db", getDbHealth);

router.use("/auth", authRoutes);
router.use("/rooms", roomRoutes);

module.exports = router;
