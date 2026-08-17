const express = require("express");

const { getApiRoot, getHealth } = require("../controllers/healthController");

const router = express.Router();

router.get("/", getApiRoot);
router.get("/health", getHealth);

module.exports = router;
