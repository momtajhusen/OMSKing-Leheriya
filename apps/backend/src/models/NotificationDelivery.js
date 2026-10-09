const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const notificationDeliverySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  eventKey: { type: String, required: true },
  dedupeKey: { type: String, required: true },
  channel: { type: String, enum: ['telegram', 'email', 'whatsapp', 'in_app'], required: true },
  text: { type: String, default: '' },
  sendId: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
}, { timestamps: true, collection: 'notification_deliveries' });

notificationDeliverySchema.index({ tenantId: 1, dedupeKey: 1, channel: 1 }, { unique: true });
notificationDeliverySchema.plugin(tenantPlugin);

module.exports = mongoose.model('NotificationDelivery', notificationDeliverySchema);
