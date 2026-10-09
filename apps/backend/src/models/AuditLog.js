const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const changeSchema = new mongoose.Schema({
  field: { type: String, required: true },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const auditLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorRole: { type: String, default: '' },
  action: { type: String, required: true },
  resourceType: { type: String, required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  resourceDisplay: { type: String, default: '' },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  changes: { type: [changeSchema], default: [] },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'audit_logs' });

auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
auditLogSchema.plugin(tenantPlugin);

function denyMutation() {
  throw new Error('Audit log is append-only');
}

auditLogSchema.pre('save', function denySave(next) {
  if (!this.isNew) return next(new Error('Audit log is append-only'));
  return next();
});
auditLogSchema.pre('updateOne', denyMutation);
auditLogSchema.pre('updateMany', denyMutation);
auditLogSchema.pre('findOneAndUpdate', denyMutation);
auditLogSchema.pre('replaceOne', denyMutation);
auditLogSchema.pre('findOneAndReplace', denyMutation);
auditLogSchema.pre('deleteOne', denyMutation);
auditLogSchema.pre('deleteMany', denyMutation);
auditLogSchema.pre('findOneAndDelete', denyMutation);

module.exports = mongoose.model('AuditLog', auditLogSchema);
