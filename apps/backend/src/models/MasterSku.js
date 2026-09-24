const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const masterSkuSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  variantAttributes: { type: Map, of: String, default: {} },
  barcode: { type: String, default: '', trim: true },
  costPrice: { type: Number, default: 0 },
  mrp: { type: Number, default: 0 },
  sellingPrice: { type: Number, default: 0 },
  weightKg: { type: Number, default: 0 },
  dimensionsCm: {
    l: { type: Number, default: 0 },
    w: { type: Number, default: 0 },
    h: { type: Number, default: 0 },
  },
  hsnCode: { type: String, default: '' },
  gstRatePercent: { type: Number, default: null },
  status: { type: String, enum: ['active', 'discontinued'], default: 'active' },
  codeLocked: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, collection: 'master_skus' });

masterSkuSchema.index({ tenantId: 1, code: 1 }, { unique: true });
masterSkuSchema.index({ tenantId: 1, barcode: 1 });
masterSkuSchema.plugin(tenantPlugin);

module.exports = mongoose.model('MasterSku', masterSkuSchema);
