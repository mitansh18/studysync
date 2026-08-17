// Load env vars before requiring the app, which reads them at import time.
require("dotenv").config();

const app = require("./app");

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`StudySync server running on http://localhost:${PORT}`);
});
