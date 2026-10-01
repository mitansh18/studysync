// Load env vars before requiring anything that reads them at import time.
require("dotenv").config();

const app = require("./app");
const { connectDB } = require("./config/db");
const { connectSql } = require("./config/sql");

const PORT = process.env.PORT || 5000;

async function start() {
  // No insecure fallback: an unsigned-secret server is worse than no server.
  if (!process.env.JWT_SECRET) {
    console.error(
      "Startup failed: missing JWT_SECRET. Copy server/.env.example to server/.env and set it."
    );
    process.exit(1);
  }

  try {
    await connectDB();
  } catch (error) {
    // The database is required, so fail loudly instead of serving requests
    // against a database that is not there.
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }

  // Same rule for the SQL stats database (Stage 4.1): configured and
  // reachable, or the server does not start. There is deliberately no
  // degraded mode - see src/config/sql.js.
  try {
    await connectSql();
  } catch (error) {
    console.error("PostgreSQL connection failed:", error.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`StudySync server running on http://localhost:${PORT}`);
  });
}

start();
