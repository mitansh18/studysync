const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

const COOKIE_NAME = "token";
const TOKEN_TTL = "7d";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

// Deliberately vague so login cannot be used to probe which emails exist.
const INVALID_CREDENTIALS = "Invalid email or password";

const isProduction = process.env.NODE_ENV === "production";

// SameSite ignores port, so localhost:3000 -> localhost:5000 counts as
// same-site and "lax" works in development. Cross-domain production needs
// "none", which in turn requires Secure.
function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
}

function issueCookie(res, userId) {
  const token = jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });

  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SEVEN_DAYS_MS });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function signup(req, res, next) {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ name, email, password: hashedPassword });

    issueCookie(res, user._id);

    return res.status(201).json({
      message: "Account created successfully",
      user: user.toSafeJSON(),
    });
  } catch (error) {
    // The unique index is the real guard against a duplicate created by two
    // concurrent requests slipping past the findOne above.
    if (error && error.code === 11000) {
      return res.status(409).json({ message: "Email is already registered" });
    }
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    // password is select:false, so ask for it explicitly.
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ message: INVALID_CREDENTIALS });
    }

    issueCookie(res, user._id);

    return res.status(200).json({
      message: "Login successful",
      user: user.toSafeJSON(),
    });
  } catch (error) {
    return next(error);
  }
}

function me(req, res) {
  return res.status(200).json({ user: req.user.toSafeJSON() });
}

function logout(req, res) {
  // Options must match those used to set the cookie or the browser keeps it.
  res.clearCookie(COOKIE_NAME, cookieOptions());
  return res.status(200).json({ message: "Logout successful" });
}

module.exports = { signup, login, me, logout };
