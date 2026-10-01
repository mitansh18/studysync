const { PrismaClient } = require("@prisma/client");

// PostgreSQL (Supabase) via Prisma - the durable, queryable trail of
// finished study sessions.
//
// This is a second database alongside MongoDB, not a replacement for it:
// users, authentication, rooms, the timer and the notes all stay in
// MongoDB, and nothing in a request's auth path touches this connection.
// Stage 4.1 only establishes the connection and the schema.
//
// Configuration is fail-fast by design: a missing DATABASE_URL is a
// startup error, never a silent "SQL is unavailable" mode, because a stats
// backbone that quietly drops sessions is worse than one that refuses to
// start.

// Names only - never the value.
const sqlConfigError = !process.env.DATABASE_URL
  ? "DATABASE_URL is missing"
  : null;

// Connection errors sometimes echo the connection string, which carries the
// database password. Never let it reach a log.
function redact(text) {
  return String(text).replace(
    /(postgres(?:ql)?:\/\/)[^@\s]*@/gi,
    "$1<credentials>@"
  );
}

function safeTarget(url) {
  try {
    const { host, pathname } = new URL(url);
    const dbName = pathname.replace(/^\//, "");
    return dbName ? `${host}/${dbName}` : host;
  } catch {
    return "<unparseable URL>";
  }
}

// One client per process, like Mongoose's connection pool. Created lazily
// so simply requiring this module never opens a connection.
let prisma = null;
let connected = false;

function getPrisma() {
  if (sqlConfigError) {
    throw new Error(
      `Missing ${sqlConfigError.replace(" is missing", "")}. Copy server/.env.example to server/.env and set it.`
    );
  }

  if (!prisma) {
    prisma = new PrismaClient();
  }

  return prisma;
}

async function connectSql() {
  const client = getPrisma();

  try {
    // Proves the URL actually reaches a database, instead of finding out on
    // the first query much later.
    await client.$connect();
  } catch (error) {
    throw new Error(redact(error.message));
  }

  connected = true;

  console.log(
    `PostgreSQL connected successfully (${safeTarget(process.env.DATABASE_URL)})`
  );

  return client;
}

async function disconnectSql() {
  if (prisma) {
    await prisma.$disconnect();
    connected = false;
  }
}

function getSqlStatus() {
  if (sqlConfigError) {
    return "unconfigured";
  }
  return connected ? "connected" : "disconnected";
}

module.exports = {
  getPrisma,
  connectSql,
  disconnectSql,
  getSqlStatus,
  sqlConfigError,
};
