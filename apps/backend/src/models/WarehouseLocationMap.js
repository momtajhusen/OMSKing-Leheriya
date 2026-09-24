const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const warehouseLocationMapSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  channel: { type: String, enum: ['shopify', 'amazon', 'myntra'], required: true },
  externalLocationId: { type: String, default: '' },
  label: { type: String, default: '' },
  isPrimaryForChannel: { type: Boolean, default: false },
}, { timestamps: true, collection: 'warehouse_location_maps' });

warehouseLocationMapSchema.index({ tenantId: 1, channel: 1, externalLocationId: 1 }, { unique: true });
warehouseLocationMapSchema.plugin(tenantPlugin);

module.exports = mongoose.model('WarehouseLocationMap', warehouseLocationMapSchema);
