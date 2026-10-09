const Order = require('../models/Order');
const SkuMapping = require('../models/SkuMapping');
const { successResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const { sessionTenantId } = require('../lib/tenantAccess');
const { getConnection, credsOf } = require('../services/channelConnection.service');
const { enqueue, toJobDto } = require('../services/jobQueue.service');
const { myntraStock, pushMyntraInventory, myntraDocument } = require('../services/myntraSync.service');
const push = require('../services/myntraPush.service');

const PUSH_BASE_PATH = '/api/v1/integrations/myntra';

function merchantTenant(req) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  return tenantId;
}

function validDate(value, label) {
  if (value == null || value === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} must be a date`);
  return d.toISOString();
}

async function status(req, res) {
  const tenantId = merchantTenant(req);
  const row = await getConnection(tenantId, 'myntra');
  const creds = row ? credsOf(row) : {};
  const [orders, lastOrder, unmapped, mapped] = await Promise.all([
    Order.countDocuments({ tenantId, channel: 'Myntra', source: { $in: ['channel_api', 'channel_push'] } }),
    Order.findOne({ tenantId, channel: 'Myntra', lastChannelSyncAt: { $ne: null } }).sort({ lastChannelSyncAt: -1 }).lean(),
    SkuMapping.countDocuments({ tenantId, channel: 'myntra', masterSkuId: null }),
    SkuMapping.countDocuments({ tenantId, channel: 'myntra', masterSkuId: { $ne: null } }),
  ]);
  return successResponse(res, {
    connected: Boolean(creds.merchantId && creds.secretKey),
    connectionStatus: row?.status || 'not_configured',
    tokenCachedAt: creds.tokenIssuedAt || null,
    hasPushToken: Boolean(creds.token),
    pushBasePath: PUSH_BASE_PATH,
    warehouseCode: creds.warehouseCode || creds.storeId || row?.warehouseCode || '',
    liveOrders: orders,
    lastOrderSyncAt: lastOrder?.lastChannelSyncAt || null,
    skuMappings: { mapped, unmapped },
  }, 'Myntra status');
}

async function rotatePushToken(req, res) {
  const token = await push.rotatePushToken(merchantTenant(req));
  return successResponse(res, { token, pushBasePath: PUSH_BASE_PATH }, 'Push token created. Copy it now; it is not shown again.');
}

async function pullOrders(req, res) {
  const tenantId = merchantTenant(req);
  const from = validDate(req.body?.from, 'from');
  const to = validDate(req.body?.to, 'to');
  const job = await enqueue({
    tenantId,
    channel: 'myntra',
    jobType: 'orders_pull',
    triggeredBy: 'manual',
    triggeredByUserId: req.user?.id,
    payload: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
  });
  return successResponse(res, toJobDto(job), 'Myntra order pull queued', 201);
}

async function stock(req, res) {
  const raw = Array.isArray(req.query.skus) ? req.query.skus.join(',') : String(req.query.skus || '');
  const skus = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!skus.length) throw new HttpError(400, 'skus query is required, e.g. ?skus=SKU1,SKU2');
  if (skus.length > 200) throw new HttpError(400, 'At most 200 SKUs per lookup');
  return successResponse(res, await myntraStock(merchantTenant(req), skus), 'Myntra stock');
}

async function pushStock(req, res) {
  if (req.body?.confirm !== true) {
    throw new HttpError(400, 'This changes live Myntra stock. Send confirm: true to proceed.');
  }
  const items = (req.body.items || []).map((item) => ({
    sku: String(item.sku || '').trim(),
    quantity: Number(item.quantity),
  }));
  if (!items.length || items.some((i) => !i.sku || !Number.isFinite(i.quantity) || i.quantity < 0)) {
    throw new HttpError(400, 'items[] needs sku and a non-negative quantity');
  }
  const result = await pushMyntraInventory(merchantTenant(req), items);
  return successResponse(res, result, 'Myntra stock updated');
}

async function packetDocument(req, res) {
  const type = req.params.type === 'invoice' ? 'invoice' : 'label';
  const tenantId = merchantTenant(req);
  const packetId = String(req.params.packetId || '');
  const owned = await Order.exists({ tenantId, 'channelLines.packetId': packetId });
  if (!owned) throw new HttpError(404, 'Packet not found on any Myntra order');
  const doc = await myntraDocument(tenantId, packetId, type);
  res.setHeader('Content-Type', doc.contentType);
  res.setHeader('Content-Disposition', `inline; filename="myntra-${type}-${packetId}.pdf"`);
  return res.send(doc.buffer);
}

function pushHandler(fn) {
  return async (req, res) => {
    try {
      const body = await fn(req);
      return res.status(200).json(body);
    } catch (err) {
      if (err instanceof push.MyntraPushError) return res.status(err.httpStatus).json(err.body);
      return res.status(500).json({ statusCode: 3001, statusMessage: 'Internal error', statusType: 'ERROR' });
    }
  };
}

const token = (req) => req.get('access_token') || req.get('access-token');

const storefrontCreateOrder = pushHandler((req) => push.createOrder({
  token: token(req), sellerOrderId: req.params.sellerOrderId, payload: req.body,
}));

const storefrontOrderEvent = pushHandler((req) => push.orderEvent({
  token: token(req), sellerOrderId: req.params.sellerOrderId, eventType: req.params.eventType, payload: req.body,
}));

const storefrontCreateReturn = pushHandler((req) => push.returnEvent({
  token: token(req), returnId: req.params.returnId, payload: req.body,
}));

const storefrontUpdateReturn = pushHandler((req) => push.returnEvent({
  token: token(req), returnId: req.params.returnId, payload: req.body, update: true,
}));

module.exports = {
  status,
  rotatePushToken,
  pullOrders,
  stock,
  pushStock,
  packetDocument,
  storefrontCreateOrder,
  storefrontOrderEvent,
  storefrontCreateReturn,
  storefrontUpdateReturn,
};
