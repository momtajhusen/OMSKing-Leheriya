const mongoose = require('mongoose');

const pricingInquirySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, default: '', trim: true },
  company: { type: String, default: '', trim: true },
  orders: { type: String, default: '', trim: true },
  products: { type: String, default: '', trim: true },
  channels: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  message: { type: String, default: '', trim: true },
}, { timestamps: true });

module.exports = mongoose.model('PricingInquiry', pricingInquirySchema);
