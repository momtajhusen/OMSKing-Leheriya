const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const CHANNELS = ['shopify', 'amazon', 'myntra'];

const webhookEventSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel: { type: String, enum: CHANNELS, required: true },
  externalEventId: { type: String, required: true, trim: true },
  topic: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  headers: { type: mongoose.Schema.Types.Mixed, default: {} },
  receivedAt: { type: Date, default: Date.now },
  processedAt: Date,
  status: {
    type: String,
    enum: ['received', 'processed', 'duplicate', 'failed'],
    default: 'received',
  },
  correlationId: { type: String, default: '' },
  lastError: { type: String, default: '' },
  duplicateCount: { type: Number, default: 0 },
  lastDuplicateAt: Date,
  applied: { type: Boolean, default: false },
  applyCount: { type: Number, default: 0 },
}, { timestamps: true, collection: 'webhook_events' });

webhookEventSchema.index({ tenantId: 1, channel: 1, externalEventId: 1 }, { unique: true });
webhookEventSchema.plugin(tenantPlugin);

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
