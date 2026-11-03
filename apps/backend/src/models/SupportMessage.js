const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

/** One report thread per merchant: its staff on one side, the OMSKing platform team on the other. */
const supportMessageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  side: { type: String, enum: ['tenant', 'platform'], required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, default: '' },
  senderRole: { type: String, default: '' },
  text: { type: String, default: '', maxlength: 4000 },
  attachment: {
    kind: { type: String, enum: ['image', 'video', 'audio', 'file'] },
    file: { type: String },
    mime: { type: String },
    bytes: { type: Number },
    name: { type: String },
    durationSec: { type: Number },
  },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportMessage', default: null },
  updateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportUpdate', default: null },
  event: {
    action: { type: String },
    status: { type: String },
    title: { type: String },
    note: { type: String },
  },
  readAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

supportMessageSchema.index({ tenantId: 1, _id: -1 });
supportMessageSchema.index({ tenantId: 1, side: 1, readAt: 1 });
supportMessageSchema.index({ tenantId: 1, updateId: 1 });
supportMessageSchema.plugin(tenantPlugin);

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
