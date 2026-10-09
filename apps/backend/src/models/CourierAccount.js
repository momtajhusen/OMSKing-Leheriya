const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const courierAccountSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  source: { type: String, enum: ['platform', 'own'], required: true },
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  mode: { type: String, enum: ['air', 'surface'], default: 'surface' },
  weightLabel: { type: String, default: '0.5kg' },
  status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
  priority: { type: Number, default: 1 },
  rateHalfKg: { type: Number, default: 0 },
  serviceability: { type: String, default: '' },
  capabilities: { type: [String], default: [] },
  credentialsEnc: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, collection: 'courier_accounts' });

courierAccountSchema.index({ tenantId: 1, source: 1, code: 1 }, { unique: true });
courierAccountSchema.plugin(tenantPlugin);

module.exports = mongoose.model('CourierAccount', courierAccountSchema);
