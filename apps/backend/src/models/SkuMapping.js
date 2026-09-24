const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const CHANNELS = ['shopify', 'amazon', 'myntra', 'custom'];
const SYNC = ['synced', 'pending', 'error', 'unmapped'];

const skuMappingSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  masterSkuId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterSku', default: null, index: true },
  channel: { type: String, enum: CHANNELS, required: true },
  channelProductId: { type: String, default: '' },
  channelVariantId: { type: String, required: true, trim: true },
  channelSkuCode: { type: String, required: true, trim: true },
  channelSkuCodeNorm: { type: String, required: true, index: true },
  channelTitle: { type: String, default: '' },
  channelSellingPrice: { type: Number, default: null },
  barcode: { type: String, default: '' },
  syncStatus: { type: String, enum: SYNC, default: 'unmapped' },
  lastSyncedAt: Date,
  lastSyncError: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, collection: 'sku_mappings' });

skuMappingSchema.index({ tenantId: 1, channel: 1, channelVariantId: 1 }, { unique: true });
skuMappingSchema.index({ tenantId: 1, masterSkuId: 1, channel: 1 });
skuMappingSchema.plugin(tenantPlugin);

module.exports = mongoose.model('SkuMapping', skuMappingSchema);
module.exports.CHANNELS = CHANNELS;
module.exports.SYNC = SYNC;
