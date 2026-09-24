const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const sessionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  userAgent: String,
  ip: String,
  device: String,
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  lastActiveAt: { type: Date, default: Date.now },
}, { timestamps: true });

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.plugin(tenantPlugin);

module.exports = mongoose.model('RefreshSession', sessionSchema);
