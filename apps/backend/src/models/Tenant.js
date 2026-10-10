const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  kind: { type: String, enum: ['platform', 'merchant'], default: 'merchant' },
  legalEntity: {
    email: String,
    phone: String,
    gstin: String,
    pan: String,
    address: String,
    city: String,
    district: String,
  },
  status: { type: String, enum: ['active', 'suspended', 'trial'], default: 'trial' },
  plan: { type: String, default: 'growth' },
  planExpiresAt: Date,
  settings: {
    currency: { type: String, default: 'INR' },
    timeZone: { type: String, default: 'Asia/Kolkata' },
    channels: { type: [String], default: [] },
    skuPrefix: { type: String, default: '' },
    storefrontUrl: { type: String, default: '' },
    inventoryAuthority: { type: String, enum: ['oms', 'shopify'], default: 'oms' },
    taxGst: {
      configured: { type: Boolean, default: false },
      defaultGstRate: { type: Number, default: 18 },
      categories: [{
        name: { type: String, default: '' },
        gstRate: { type: Number, default: 0 },
      }],
      hsnMaster: [{
        hsn: { type: String, default: '' },
        description: { type: String, default: '' },
        gstRate: { type: Number, default: null },
      }],
    },
    notifications: {
      botTokenEnc: { type: String, default: '' },
      ownerChatId: { type: String, default: '' },
      events: { type: mongoose.Schema.Types.Mixed, default: undefined },
      whatsapp: {
        phoneNumberId: { type: String, default: '' },
        tokenEnc: { type: String, default: '' },
        to: { type: String, default: '' },
      },
    },
    mail: {
      gmailUser: { type: String, default: '' },
      gmailAppPasswordEnc: { type: String, default: '' },
    },
  },
  onboardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
