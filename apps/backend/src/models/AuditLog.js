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

function denyMutation(next) {
  const err = new Error('Audit log is append-only');
  if (typeof next === 'function') return next(err);
  throw err;
}

function denyBulk(next, ops) {
  const list = Array.isArray(ops) ? ops : [];
  const changesRow = list.some((op) => op && (op.updateOne || op.updateMany || op.deleteOne || op.deleteMany || op.replaceOne));
  if (!list.length || changesRow) return next(new Error('Audit log is append-only'));
  return next();
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
auditLogSchema.pre('deleteOne', { document: false, query: true }, denyMutation);
auditLogSchema.pre('deleteOne', { document: true, query: false }, denyMutation);
auditLogSchema.pre('deleteMany', denyMutation);
auditLogSchema.pre('findOneAndDelete', denyMutation);
auditLogSchema.pre('bulkWrite', denyBulk);

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

const BLOCKED_WRITES = [
  'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
];

function lockAuditCollection(collection) {
  if (!collection || collection.auditAppendOnly) return;
  collection.auditAppendOnly = true;
  const refuse = () => Promise.reject(new Error('Audit log is append-only'));
  for (const name of BLOCKED_WRITES) collection[name] = refuse;
  const insertBulk = collection.bulkWrite.bind(collection);
  collection.bulkWrite = function auditBulk(ops, options) {
    const list = Array.isArray(ops) ? ops : [];
    const insertOnly = list.length > 0 && list.every((op) => op && op.insertOne && Object.keys(op).every((key) => key === 'insertOne'));
    if (!insertOnly) return Promise.reject(new Error('Audit log is append-only'));
    return insertBulk(ops, options);
  };
}

lockAuditCollection(AuditLog.collection);
mongoose.connection.on('connected', () => lockAuditCollection(AuditLog.collection));

module.exports = AuditLog;
