const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const MOVEMENT = [
  'purchase_receipt', 'order_reserve', 'order_release', 'fulfilment_deduct', 'fulfilment_revert',
  'transfer_out', 'transfer_in', 'return_restock', 'rto_restock',
  'adjustment_plus', 'adjustment_minus', 'physical_count', 'virtual_sync',
];

const ledgerSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  masterSkuId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterSku', required: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  transactionId: { type: String, required: true, index: true },
  movementType: { type: String, enum: MOVEMENT, required: true },
  qtyDelta: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  reservedAfter: { type: Number, default: 0 },
  availableAfter: { type: Number, default: 0 },
  channel: { type: String, default: '' },
  referenceType: { type: String, default: '' },
  referenceId: { type: String, default: '' },
  reason: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recordedAt: { type: Date, default: Date.now },
}, { timestamps: false, collection: 'inventory_ledgers' });

ledgerSchema.index({ tenantId: 1, recordedAt: -1 });
ledgerSchema.index({ tenantId: 1, masterSkuId: 1, warehouseId: 1, recordedAt: -1 });
ledgerSchema.plugin(tenantPlugin);

function denyMutation() {
  throw new Error('Inventory ledger is immutable');
}

ledgerSchema.pre('save', function denySave(next) {
  if (!this.isNew) return next(new Error('Inventory ledger is immutable'));
  next();
});
ledgerSchema.pre('updateOne', denyMutation);
ledgerSchema.pre('updateMany', denyMutation);
ledgerSchema.pre('findOneAndUpdate', denyMutation);
ledgerSchema.pre('replaceOne', denyMutation);
ledgerSchema.pre('findOneAndReplace', denyMutation);
ledgerSchema.pre('deleteOne', denyMutation);
ledgerSchema.pre('deleteMany', denyMutation);
ledgerSchema.pre('findOneAndDelete', denyMutation);

module.exports = mongoose.model('InventoryLedger', ledgerSchema);
module.exports.MOVEMENT = MOVEMENT;
