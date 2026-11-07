const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const settlementImportSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  source: { type: String, default: '' },
  hash: { type: String, required: true },
  rows: { type: Number, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

settlementImportSchema.index({ tenantId: 1, hash: 1 }, { unique: true });
settlementImportSchema.plugin(tenantPlugin);

module.exports = mongoose.model('SettlementImport', settlementImportSchema);
