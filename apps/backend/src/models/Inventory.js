const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const inventorySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  masterSkuId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterSku', required: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  physicalQty: { type: Number, default: 0, min: 0 },
  virtualQty: { type: Number, default: 0, min: 0 },
  reservedQty: { type: Number, default: 0, min: 0 },
  reorderPoint: { type: Number, default: 10, min: 0 },
  safetyStock: { type: Number, default: 0, min: 0 },
  lastCountedAt: Date,
  lastCountedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lowStockAlertedAt: Date,
}, { timestamps: true, collection: 'inventory' });

inventorySchema.index({ tenantId: 1, masterSkuId: 1, warehouseId: 1 }, { unique: true });
inventorySchema.plugin(tenantPlugin);

inventorySchema.virtual('availableQty').get(function availableQty() {
  return (this.physicalQty || 0) + (this.virtualQty || 0) - (this.reservedQty || 0);
});

inventorySchema.virtual('onHandQty').get(function onHandQty() {
  return (this.physicalQty || 0) + (this.virtualQty || 0);
});

module.exports = mongoose.model('Inventory', inventorySchema);
