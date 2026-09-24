const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const passwordResetSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: Date,
  attempts: { type: Number, default: 0 },
}, { timestamps: true });

passwordResetSchema.plugin(tenantPlugin);

module.exports = mongoose.model('PasswordReset', passwordResetSchema);
