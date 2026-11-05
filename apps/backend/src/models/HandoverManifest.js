const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const rowSchema = new mongoose.Schema({
  orderNo: { type: String, default: '' },
  channelOrderNo: { type: String, default: '' },
  channel: { type: String, default: '' },
  awb: { type: String, default: '' },
  customer: { type: String, default: '' },
  city: { type: String, default: '' },
  pincode: { type: String, default: '' },
  paymentMode: { type: String, default: '' },
  codAmount: { type: Number, default: 0 },
  qty: { type: Number, default: 0 },
  weightKg: { type: Number, default: 0 },
}, { _id: false });

const handoverManifestSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  manifestNo: { type: String, required: true },
  courier: { type: String, default: '' },
  warehouseCode: { type: String, default: '' },
  day: { type: String, default: '' },
  rows: { type: [rowSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, collection: 'handover_manifests' });

handoverManifestSchema.index({ tenantId: 1, manifestNo: 1 }, { unique: true });
handoverManifestSchema.index({ tenantId: 1, createdAt: -1 });
handoverManifestSchema.plugin(tenantPlugin);

module.exports = mongoose.model('HandoverManifest', handoverManifestSchema);
