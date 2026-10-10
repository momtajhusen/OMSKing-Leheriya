const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const itemSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  sku: { type: String, default: '' },
  qty: { type: Number, default: 1 },
  price: { type: Number, default: 0 },
  cost: { type: Number },
  hsn: { type: String, default: '' },
  gst: { type: Number, default: 0 },
  masterSkuId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterSku', default: null },
  skuMappingId: { type: mongoose.Schema.Types.ObjectId, ref: 'SkuMapping', default: null },
  imageUrl: { type: String, default: '' },
  fulfilmentSource: { type: String, default: 'Offline' },
  locationId: { type: String, default: '' },
}, { _id: false });

const subOrderSchema = new mongoose.Schema({
  id: { type: String, required: true },
  index: { type: Number, required: true },
  sku: { type: String, default: '' },
  masterSkuId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterSku', default: null },
  title: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  qty: { type: Number, default: 1 },
  price: { type: Number, default: 0 },
  assignedVendor: { type: String, default: '' },
  vendorPhone: { type: String, default: '' },
  vendorEmail: { type: String, default: '' },
  vendorLocation: { type: String, default: '' },
  assignedDate: { type: String, default: '' },
  dispatchDate: { type: String, default: '' },
  deliveryStatus: { type: String, default: 'Pending' },
  status: { type: String, default: 'New' },
  address: { type: String, default: '' },
  customer: { type: String, default: '' },
  fulfilmentSource: { type: String, default: 'Offline' },
  vendorStatus: {
    type: String,
    enum: ['', 'Pending Acceptance', 'Accepted', 'Rejected', 'Ready to Dispatch', 'Dispatched', 'Delivered'],
    default: '',
  },
  rejectReason: { type: String, default: '' },
  trackingNumber: { type: String, default: '' },
  courier: { type: String, default: '' },
  deliveredDate: { type: String, default: '' },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  orderNo: { type: String, required: true, trim: true },
  customer: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  channel: { type: String, default: 'Shopify' },
  status: { type: String, default: 'New' },
  paymentMode: { type: String, default: 'COD' },
  paymentStatus: { type: String, enum: ['', 'paid', 'partially_paid', 'unpaid'], default: '' },
  shipState: { type: String, default: '' },
  fulfilmentSource: { type: String, default: 'Offline' },
  assignedVendor: { type: String, default: '' },
  shopifyVendor: { type: String, default: '' },
  items: { type: [itemSchema], default: [] },
  subOrders: { type: [subOrderSchema], default: [] },
  total: { type: Number, default: 0 },
  courier: { type: String, default: '' },
  awb: { type: String, default: '' },
  invoiceNo: { type: String, default: '' },
  labelGeneratedAt: { type: Date },
  invoiceGeneratedAt: { type: Date },
  orderDate: { type: Date },
  reversePickup: {
    returnId: { type: String, default: '' },
    awb: { type: String, default: '' },
    courier: { type: String, default: '' },
    reason: { type: String, default: '' },
    bookedAt: { type: Date },
  },
  source: { type: String, enum: ['demo', 'manual', 'channel_api', 'channel_push'], default: 'demo' },
  externalOrderId: { type: String, default: '' },
  channelStatus: { type: String, default: '' },
  reserveState: { type: String, enum: ['', 'reserved', 'out_of_stock', 'unmapped'], default: '' },
  rtoRestockedAt: { type: Date },
  sourceOrderData: { type: mongoose.Schema.Types.Mixed },
  warehouseCode: { type: String, default: '' },
  channelLines: {
    type: [new mongoose.Schema({
      sellerOrderId: String,
      orderLineId: String,
      sku: String,
      imageUrl: String,
      status: String,
      packetId: String,
      invoiceNumber: String,
      trackingNumber: String,
      courierCode: String,
      cancellationReason: String,
      packByTime: Date,
      shipByTime: Date,
    }, { _id: false })],
    default: [],
  },
  lastChannelSyncAt: { type: Date },
}, { timestamps: true });

orderSchema.index({ tenantId: 1, orderNo: 1 }, { unique: true });
orderSchema.index(
  { tenantId: 1, channel: 1, externalOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalOrderId: { $gt: '' } },
  },
);
orderSchema.index({ tenantId: 1, 'subOrders.id': 1 });
orderSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Order', orderSchema);
