const { Schema } = require("mongoose");

const UsersSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    salt: { type: String, required: true },
    cash: { type: Number, required: true, default: 10000, min: 0 },
  },
  { timestamps: true },
);

module.exports = { UsersSchema };
