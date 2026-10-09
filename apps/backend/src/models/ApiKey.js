const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const apiKeySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  label: { type: String, required: true, trim: true },
  prefix: { type: String, required: true },
  keyHash: { type: String, required: true },
  scopes: { type: [String], default: ['read'] },
  status: { type: String, enum: ['active', 'revoked'], default: 'active' },
  lastUsedAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, collection: 'api_keys' });

apiKeySchema.index({ tenantId: 1, keyHash: 1 }, { unique: true });
apiKeySchema.plugin(tenantPlugin);

module.exports = mongoose.model('ApiKey', apiKeySchema);
