const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const roleSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  code: { type: String, required: true },
  description: String,
  permissions: { type: [String], default: [] },
  isSystem: { type: Boolean, default: true },
}, { timestamps: true });

roleSchema.index({ tenantId: 1, code: 1 }, { unique: true });
roleSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Role', roleSchema);
