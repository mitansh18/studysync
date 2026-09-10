const { getDbStatus } = require("../config/db");

const SERVICE_NAME = "StudySync API";

function getApiRoot(req, res) {
  res.status(200).json({
    success: true,
    message: "StudySync API is running",
  });
}

function getHealth(req, res) {
  res.status(200).json({
    success: true,
    status: "healthy",
    service: SERVICE_NAME,
  });
}

// Development health check: reports live MongoDB connection state.
function getDbHealth(req, res) {
  const database = getDbStatus();
  const connected = database === "connected";

  res.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "error",
    database,
  });
}

module.exports = { getApiRoot, getHealth, getDbHealth };
