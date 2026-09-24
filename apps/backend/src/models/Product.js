const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const productSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  brand: { type: String, default: '' },
  category: { type: String, default: '' },
  hsnCode: { type: String, default: '' },
  gstRatePercent: { type: Number, default: 5 },
  images: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'draft', 'archived'], default: 'active' },
  tags: { type: [String], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

productSchema.index({ tenantId: 1, name: 1 });
productSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Product', productSchema);
