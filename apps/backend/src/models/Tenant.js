const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  kind: { type: String, enum: ['platform', 'merchant'], default: 'merchant' },
  legalEntity: {
    legalName: String,
    /** Label / packing-slip brand; falls back to tenant name when blank. */
    brandName: String,
    email: String,
    phone: String,
    gstin: String,
    pan: String,
    address: String,
    city: String,
    district: String,
    /** GST / invoice seller state (e.g. Delhi, Gujarat) — never assume one tenant's state. */
    state: String,
    /** Shown on tax invoice header (e.g. www.example.com). */
    website: String,
    /** Public path e.g. /uploads/{tenantId}/logo-….png — used on labels & invoices. */
    logoUrl: String,
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
    warehouseLinksCustom: { type: Boolean, default: false },
    packageDefaults: {
      weightKg: { type: Number, default: 0.45 },
      lengthCm: { type: Number, default: 10 },
      breadthCm: { type: Number, default: 10 },
      heightCm: { type: Number, default: 10 },
    },
    taxGst: {
      configured: { type: Boolean, default: false },
      defaultGstRate: { type: Number, default: 18 },
      /** Used on invoice lines when Master SKU / product HSN is blank. */
      defaultHsn: { type: String, default: '' },
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
