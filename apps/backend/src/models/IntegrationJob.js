const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const CHANNELS = ['shopify', 'amazon', 'myntra'];
const JOB_TYPES = [
  'orders_pull',
  'orders_status_push',
  'products_pull',
  'inventory_push',
  'shipment_push',
  'return_pull',
  'webhook_dispatch',
  'manual',
];

const integrationJobSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel: { type: String, enum: CHANNELS, required: true },
  jobType: { type: String, enum: JOB_TYPES, required: true },
  direction: { type: String, enum: ['pull', 'push'], default: 'pull' },
  status: {
    type: String,
    enum: ['queued', 'running', 'success', 'partial_success', 'failed', 'cancelled'],
    default: 'queued',
  },
  startedAt: Date,
  finishedAt: Date,
  durationMs: Number,
  recordsTotal: { type: Number, default: 0 },
  recordsProcessed: { type: Number, default: 0 },
  recordsFailed: { type: Number, default: 0 },
  retriesCount: { type: Number, default: 0 },
  maxRetries: { type: Number, default: 5 },
  triggeredBy: { type: String, enum: ['scheduler', 'manual', 'webhook'], default: 'manual' },
  triggeredByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  webhookEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'WebhookEvent', default: null },
  parentJobId: { type: mongoose.Schema.Types.ObjectId, default: null },
  shortSummary: { type: String, default: '' },
  lastError: { type: String, default: '' },
  nextRunAt: { type: Date, default: Date.now },
  lockedAt: Date,
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  effectApplied: { type: Boolean, default: false },
  effectCount: { type: Number, default: 0 },
}, { timestamps: true, collection: 'integration_jobs' });

integrationJobSchema.index({ status: 1, nextRunAt: 1 });
integrationJobSchema.index({ tenantId: 1, channel: 1, createdAt: -1 });
integrationJobSchema.plugin(tenantPlugin);

module.exports = mongoose.model('IntegrationJob', integrationJobSchema);
