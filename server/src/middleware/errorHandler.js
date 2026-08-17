// Express recognises an error handler by its four-parameter signature,
// so `next` must stay even though it is unused.
function errorHandler(err, req, res, next) {
  // Logged server-side only; the client never sees the stack.
  console.error(err);

  const status = err.status || err.statusCode || 500;

  // Client errors can state their reason; server errors stay generic.
  const message = status < 500 ? err.message : "Internal Server Error";

  res.status(status).json({
    success: false,
    message,
  });
}

module.exports = errorHandler;
