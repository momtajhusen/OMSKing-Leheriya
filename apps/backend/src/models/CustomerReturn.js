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
  kind: { type: String, enum: ['customer', 'rto'], default: 'customer' },
  qcStatus: { type: String, enum: ['pending', 'pass', 'fail', 'hold'], default: 'pending' },
  qcNote: { type: String, default: '' },
  refundStatus: { type: String, enum: ['not_due', 'pending', 'refunded', 'rejected'], default: 'pending' },
  refundAmount: { type: Number, default: 0 },
  receivingAt: { type: Date, default: null },
  claim: {
    type: { type: String, enum: ['', 'safet', 'myntra'], default: '' },
    status: { type: String, enum: ['none', 'to_file', 'filed', 'approved', 'rejected'], default: 'none' },
    claimId: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    note: { type: String, default: '' },
    filedAt: { type: Date, default: null },
    settledAt: { type: Date, default: null },
  },
}, { timestamps: true, collection: 'customer_returns' });

customerReturnSchema.index({ tenantId: 1, returnNo: 1 }, { unique: true });
customerReturnSchema.plugin(tenantPlugin);

module.exports = mongoose.model('CustomerReturn', customerReturnSchema);
