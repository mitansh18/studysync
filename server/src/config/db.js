const mongoose = require("mongoose");

// Driver errors sometimes echo the connection string. Never let credentials
// reach a log.
function redact(text) {
  return String(text).replace(
    /(mongodb(?:\+srv)?:\/\/)[^@\s]*@/gi,
    "$1<credentials>@"
  );
}

function safeTarget(uri) {
  try {
    const { host, pathname } = new URL(uri);
    const dbName = pathname.replace(/^\//, "");
    return dbName ? `${host}/${dbName}` : host;
  } catch {
    return "<unparseable URI>";
  }
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI. Copy server/.env.example to server/.env and set it."
    );
  }

  try {
    // Mongoose keeps one connection pool per process, so calling this once
    // at startup is enough.
    await mongoose.connect(uri);
  } catch (error) {
    throw new Error(redact(error.message));
  }

  console.log(`MongoDB connected successfully (${safeTarget(uri)})`);

  return mongoose.connection;
}

function getDbStatus() {
  // readyState: 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return states[mongoose.connection.readyState] || "unknown";
}

module.exports = { connectDB, getDbStatus };
