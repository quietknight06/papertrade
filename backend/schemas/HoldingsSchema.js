const { Schema } = require("mongoose");

const HoldingsSchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: String,
  qty: Number,
  avg: Number,
  price: Number,
  net: String,
  day: String,
  isLoss: Boolean,
});

HoldingsSchema.index(
  { userId: 1, name: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "string" } } },
);

module.exports = { HoldingsSchema };
