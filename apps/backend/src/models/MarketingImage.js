const mongoose = require('mongoose');

/** Images on the public OMSKing website. Owned by the platform, not by any merchant. */
const marketingImageSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  url: { type: String, required: true },
  alt: { type: String, default: '', trim: true },
  mime: { type: String, default: '' },
  bytes: { type: Number, default: 0 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('MarketingImage', marketingImageSchema);
