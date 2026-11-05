const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const STATUSES = ['pending', 'in_progress', 'done', 'confirmed'];

const historySchema = new mongoose.Schema({
  action: { type: String, required: true },
  status: { type: String, enum: STATUSES, required: true },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  byName: { type: String, default: '' },
  side: { type: String, enum: ['tenant', 'platform'], required: true },
  note: { type: String, default: '' },
  at: { type: Date, default: Date.now },
}, { _id: false });

/** A report the team tracks to done: raised from one chat message, replies to it join the same update. */
const supportUpdateSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  status: { type: String, enum: STATUSES, default: 'pending' },
  sourceMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportMessage', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
  createdSide: { type: String, enum: ['tenant', 'platform'], required: true },
  doneByName: { type: String, default: '' },
  doneAt: { type: Date, default: null },
  confirmedByName: { type: String, default: '' },
  confirmedAt: { type: Date, default: null },
  issue: { type: String, default: '', maxlength: 200 },
  fix: { type: String, default: '', maxlength: 200 },
  area: { type: String, default: '', maxlength: 120 },
  check: { type: String, default: '', maxlength: 300 },
  history: { type: [historySchema], default: [] },
}, { timestamps: true });

supportUpdateSchema.index({ tenantId: 1, sourceMessageId: 1 }, { unique: true });
supportUpdateSchema.index({ tenantId: 1, status: 1, updatedAt: -1 });
supportUpdateSchema.plugin(tenantPlugin);

module.exports = mongoose.model('SupportUpdate', supportUpdateSchema);
module.exports.STATUSES = STATUSES;
