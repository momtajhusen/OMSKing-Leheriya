const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const customerReturnSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  returnNo: { type: String, required: true, trim: true },
  orderNo: { type: String, required: true, trim: true },
  channel: { type: String, default: '' },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Completed'], default: 'Pending' },
  reason: { type: String, default: '' },
  items: {
    type: [new mongoose.Schema({
      sku: { type: String, default: '' },
      qty: { type: Number, default: 1 },
      name: { type: String, default: '' },
    }, { _id: false })],
    default: [],
  },
  restockDestination: { type: String, default: '' },
  labelAwb: { type: String, default: '' },
}, { timestamps: true, collection: 'customer_returns' });

customerReturnSchema.index({ tenantId: 1, returnNo: 1 }, { unique: true });
customerReturnSchema.plugin(tenantPlugin);

module.exports = mongoose.model('CustomerReturn', customerReturnSchema);
