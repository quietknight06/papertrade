const { Schema } = require("mongoose");

const OrdersSchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: String,
  qty: Number,
  price: Number,
  mode: String,
  status: { type: String, enum: ["OPEN", "FILLED", "REJECTED"], default: "OPEN" },
  fillPrice: Number,
  filledAt: Date,
  rejectionReason: String,
}, { timestamps: true });

module.exports = { OrdersSchema };
