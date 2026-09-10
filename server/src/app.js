const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const routes = require("./routes");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// Fall back to the local frontend so a missing CLIENT_URL never widens
// this to an open origin. credentials:true is required for the auth cookie.
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api", routes);

// Both must stay last, and in this order.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
