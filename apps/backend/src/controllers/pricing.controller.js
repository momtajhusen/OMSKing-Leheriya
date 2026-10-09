const { successResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const PricingInquiry = require('../models/PricingInquiry');
const { ensurePricing, present, quoteOrders, savePricing } = require('../services/pricing.service');

async function getPricing(req, res) {
  const doc = await ensurePricing();
  const orders = req.query.orders;
  const data = present(doc);
  if (orders != null && orders !== '') data.quote = quoteOrders(orders, doc);
  return successResponse(res, data, 'Pricing');
}

async function putPricing(req, res) {
  const doc = await savePricing(req.body);
  return successResponse(res, present(doc), 'Pricing updated');
}

async function createInquiry(req, res) {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').replace(/[\s-]/g, '');
  if (name.length < 2) throw new HttpError(400, 'Name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  if (phone && !/^(?:\+91)?[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a 10-digit mobile number');

  const since = new Date(Date.now() - 10 * 60 * 1000);
  const recent = await PricingInquiry.findOne({ email, createdAt: { $gt: since } });
  if (recent) {
    return successResponse(res, { id: String(recent._id) }, 'We already have this pricing request');
  }

  const row = await PricingInquiry.create({
    name,
    email,
    phone,
    company: String(req.body.company || '').trim(),
    orders: String(req.body.orders || '').trim(),
    products: String(req.body.products || '').trim(),
    channels: String(req.body.channels || '').trim(),
    city: String(req.body.city || '').trim(),
    message: String(req.body.message || '').trim(),
  });
  return successResponse(res, { id: String(row._id) }, 'Pricing request received', 201);
}

async function listInquiries(_req, res) {
  const rows = await PricingInquiry.find().sort({ createdAt: -1 }).limit(100).lean();
  return successResponse(res, rows.map((row) => ({
    id: String(row._id),
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    company: row.company || '',
    orders: row.orders || '',
    products: row.products || '',
    channels: row.channels || '',
    city: row.city || '',
    message: row.message || '',
    createdAt: row.createdAt,
  })), 'Pricing requests');
}

module.exports = { getPricing, putPricing, createInquiry, listInquiries };
