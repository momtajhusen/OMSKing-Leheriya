const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const reservationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  masterSkuId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterSku', required: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  orderRef: { type: String, required: true, trim: true },
  channel: { type: String, enum: ['shopify', 'amazon', 'myntra', 'manual'], required: true },
  qty: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['held', 'consumed', 'released'], default: 'held' },
  idempotencyKey: { type: String, required: true },
  reason: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, collection: 'inventory_reservations' });

reservationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
reservationSchema.index({ tenantId: 1, orderRef: 1, masterSkuId: 1, warehouseId: 1, status: 1 });
reservationSchema.plugin(tenantPlugin);

module.exports = mongoose.model('InventoryReservation', reservationSchema);
