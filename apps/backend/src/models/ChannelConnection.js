const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const CHANNELS = ['shopify', 'amazon', 'myntra', 'flipkart', 'meesho', 'ajio', 'nykaa', 'custom'];

const channelConnectionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel: { type: String, enum: CHANNELS, required: true },
  status: { type: String, enum: ['not_configured', 'saved', 'connected', 'error'], default: 'not_configured' },
  lastTestAt: Date,
  lastTestOk: Boolean,
  lastTestMessage: { type: String, default: '' },
  importOrdersFrom: Date,
  warehouseCode: { type: String, default: '' },
  credentialsEnc: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, collection: 'channel_connections' });

channelConnectionSchema.index({ tenantId: 1, channel: 1 }, { unique: true });
channelConnectionSchema.plugin(tenantPlugin);

module.exports = mongoose.model('ChannelConnection', channelConnectionSchema);
