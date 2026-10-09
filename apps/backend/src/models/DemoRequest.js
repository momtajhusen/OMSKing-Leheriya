const mongoose = require('mongoose');

const demoRequestSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  company: { type: String, required: true, trim: true },
  city: { type: String, default: '', trim: true },
  monthlyOrders: { type: String, required: true },
  channels: { type: [String], default: [] },
  message: { type: String, default: '', trim: true },
}, { timestamps: true });

module.exports = mongoose.model('DemoRequest', demoRequestSchema);
