const mongoose = require('mongoose');

const platformSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  gmailUser: { type: String, default: '' },
  gmailAppPasswordEnc: { type: String, default: '' },
  fromName: { type: String, default: 'OMSKing' },
  emailBrand: { type: String, default: 'OMSKing' },
  trialDays: { type: Number, default: 14 },
  orderPullMinutes: { type: Number, default: 15 },
  publicAppUrl: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('PlatformSetting', platformSettingSchema);
