const DemoRequest = require('../models/DemoRequest');
const { HttpError } = require('../utils/httpError');
const { paginatedResponse } = require('../utils/response');
const { pageOf } = require('../utils/page');

const ORDER_BANDS = ['under-500', '500-2000', '2000-10000', '10000-plus'];
const CHANNELS = ['Shopify', 'Amazon', 'Myntra'];

function cleanPhone(value) {
  return String(value || '').replace(/[\s-]/g, '');
}

async function createDemoRequest(req, res) {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = cleanPhone(req.body.phone);
  const company = String(req.body.company || '').trim();
  const city = String(req.body.city || '').trim();
  const monthlyOrders = String(req.body.monthlyOrders || '');
  const channels = [...new Set((Array.isArray(req.body.channels) ? req.body.channels : []).filter((item) => CHANNELS.includes(item)))];
  const message = String(req.body.message || '').trim();

  if (name.length < 2) throw new HttpError(400, 'Full name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid work email');
  if (!/^(?:\+91)?[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'Enter a 10-digit mobile number');
  if (company.length < 2) throw new HttpError(400, 'Company name is required');
  if (!ORDER_BANDS.includes(monthlyOrders)) throw new HttpError(400, 'Choose a monthly order band');
  if (!channels.length) throw new HttpError(400, 'Choose at least one channel');

  const since = new Date(Date.now() - 10 * 60 * 1000);
  const recent = await DemoRequest.findOne({ email, createdAt: { $gt: since } });
  if (recent) {
    return res.json({
      success: true,
      message: 'We already have this demo request.',
      data: { id: String(recent._id) },
    });
  }

  const row = await DemoRequest.create({
    name, email, phone, company, city, monthlyOrders, channels, message,
  });
  return res.status(201).json({
    success: true,
    message: 'Demo request received',
    data: { id: String(row._id) },
  });
}

async function listDemoRequests(req, res) {
  const rows = await DemoRequest.find().sort({ createdAt: -1 }).limit(500).lean();
  const data = rows.map((row) => ({
    id: String(row._id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    city: row.city || '',
    monthlyOrders: row.monthlyOrders,
    channels: row.channels || [],
    message: row.message || '',
    createdAt: row.createdAt,
  }));
  const paged = pageOf(data, req.query);
  return paginatedResponse(res, paged.rows, paged.page, paged.limit, paged.total, 'Demo requests');
}

module.exports = { createDemoRequest, listDemoRequests, ORDER_BANDS, CHANNELS };
