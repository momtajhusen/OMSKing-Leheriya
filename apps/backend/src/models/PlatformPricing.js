const mongoose = require('mongoose');

const slabSchema = new mongoose.Schema({
  upTo: { type: Number, default: null },
  ratePaise: { type: Number, required: true },
}, { _id: false });

const platformPricingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  minimumMonthlyPaise: { type: Number, required: true, default: 100000 },
  slabs: { type: [slabSchema], default: [] },
  payment: {
    upiId: { type: String, default: '' },
    accountName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    ifsc: { type: String, default: '' },
    bankName: { type: String, default: '' },
    note: { type: String, default: '' },
    razorpayKeyId: { type: String, default: '' },
    razorpayKeySecretEnc: { type: String, default: '' },
    razorpayWebhookSecretEnc: { type: String, default: '' },
  },
}, { timestamps: true });

module.exports = mongoose.model('PlatformPricing', platformPricingSchema);
