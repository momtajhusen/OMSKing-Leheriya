const mongoose = require('mongoose');
const { tenantPlugin } = require('../plugins/tenantPlugin');

const warehouseSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['physical', 'virtual'], required: true },
  isDefault: { type: Boolean, default: false },
  sellOnShopify: { type: Boolean, default: true },
  sellOnAmazon: { type: Boolean, default: false },
  sellOnMyntra: { type: Boolean, default: false },
  isPickup: { type: Boolean, default: false },
  address: {
    line1: { type: String, default: '' },
    line2: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pincode: { type: String, default: '' },
    gstin: { type: String, default: '' },
  },
  contactPerson: { type: String, default: '' },
  contactPhone: { type: String, default: '' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true, collection: 'warehouses' });

warehouseSchema.index({ tenantId: 1, code: 1 }, { unique: true });
warehouseSchema.plugin(tenantPlugin);

module.exports = mongoose.model('Warehouse', warehouseSchema);
