const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const userSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: String,
  passwordHash: { type: String, required: true },
  avatarUrl: String,
  roleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
  status: { type: String, enum: ['active', 'disabled', 'invited'], default: 'active' },
  lastLoginAt: Date,
  refreshTokenVersion: { type: Number, default: 0 },
  assignedVendorIds: [{ type: mongoose.Schema.Types.ObjectId }],
  twoFactorEnabled: { type: Boolean, default: false },
}, { timestamps: true });

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.plugin(tenantPlugin);

module.exports = mongoose.model('User', userSchema);
