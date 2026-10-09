const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const shipmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderNo: { type: String, required: true, trim: true },
  channel: { type: String, required: true, trim: true },
  courier: { type: String, required: true, trim: true },
  awb: { type: String, default: '' },
  status: { type: String, enum: ['booked', 'cancelled'], default: 'booked' },
  warehouseCode: { type: String, default: 'WH-001' },
  shopifyFulfillmentId: { type: String, default: '' },
  labelPdf: { type: Buffer, default: null },
  reserveReleased: { type: Boolean, default: false },
  bookedAt: { type: Date },
  cancelledAt: { type: Date },
  pickupRequestedAt: { type: Date, default: null },
  deliveryStatus: { type: String, default: '' },
  trackingEvents: {
    type: [new mongoose.Schema({
      status: { type: String, required: true },
      detail: { type: String, default: '' },
      attempt: { type: Number, default: 0 },
      eventKey: { type: String, required: true },
      at: { type: Date, default: Date.now },
    }, { _id: false })],
    default: [],
  },
}, { timestamps: true, collection: 'shipments' });

shipmentSchema.index({ tenantId: 1, orderNo: 1, status: 1 });
shipmentSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Shipment', shipmentSchema);
