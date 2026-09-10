const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    // Always a bcrypt hash, never plaintext. Excluded from queries by
    // default so it cannot leak into a response by accident.
    password: {
      type: String,
      required: true,
      select: false,
    },
  },
  { timestamps: true }
);

// The only shape of a user that may be sent to a client.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
  };
};

module.exports = mongoose.model("User", userSchema);
