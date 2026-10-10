const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const subscriptionPaymentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  period: { type: String, required: true },
  orders: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'submitted'], default: 'paid' },
  note: { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
  paidAt: { type: Date },
}, { timestamps: true });

subscriptionPaymentSchema.index({ tenantId: 1, period: 1 }, { unique: true });
subscriptionPaymentSchema.plugin(tenantPlugin);

module.exports = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
