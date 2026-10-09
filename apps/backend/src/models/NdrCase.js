const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const ndrCaseSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderNo: { type: String, required: true, trim: true },
  awb: { type: String, default: '' },
  reason: { type: String, default: '' },
  attempt: { type: Number, default: 1 },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  status: { type: String, enum: ['open', 'reattempt', 'rto'], default: 'open' },
}, { timestamps: true, collection: 'ndr_cases' });

ndrCaseSchema.index({ tenantId: 1, orderNo: 1 }, { unique: true });
ndrCaseSchema.plugin(tenantPlugin);

module.exports = mongoose.model('NdrCase', ndrCaseSchema);
