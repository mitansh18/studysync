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

module.exports = { getApiRoot, getHealth };
