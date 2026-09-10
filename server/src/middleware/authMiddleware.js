const jwt = require("jsonwebtoken");

const User = require("../models/User");

const UNAUTHORIZED = { message: "Not authenticated" };

// Reads the JWT from the httpOnly cookie and attaches the user to the request.
// Every failure mode returns the same generic 401 - no JWT internals leak out.
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;

  if (!token) {
    return res.status(401).json(UNAUTHORIZED);
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    // Covers malformed, tampered and expired tokens alike.
    return res.status(401).json(UNAUTHORIZED);
  }

  try {
    const user = await User.findById(payload.userId);

    // The token can outlive the account it points at.
    if (!user) {
      return res.status(401).json(UNAUTHORIZED);
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = requireAuth;
