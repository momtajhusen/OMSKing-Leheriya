const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const vendorSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true },
  nameNorm: { type: String, required: true },
  location: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  telegramGroup: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  source: { type: String, enum: ['manual', 'shopify'], default: 'manual' },
  removed: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, collection: 'vendors' });

vendorSchema.index({ tenantId: 1, nameNorm: 1 }, { unique: true });
vendorSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Vendor', vendorSchema);
