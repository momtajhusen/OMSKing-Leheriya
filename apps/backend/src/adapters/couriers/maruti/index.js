const https = require('https');
const { URL } = require('url');
const { gatedRequest } = require('../../liveGate');

/**
 * Official Innofulfill API host (from docs.innofulfill.com + portal JS).
 * Older guesses used api.innofulfill.com (API Gateway 403). Override with credentials.apiBaseUrl if needed.
 */
const DEFAULT_HOST = 'https://apis.innofulfill.com';

function httpCall(method, url, { headers = {}, body } = {}) {
  const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      const err = new Error('Channel calls must use HTTPS');
      err.statusCode = 400;
      reject(err);
      return;
    }
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: `${u.pathname}${u.search}`,
      method,
      family: 4,
      timeout: 20000,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ status: res.statusCode, text: buffer.toString('utf8'), buffer, headers: res.headers });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out reaching ${u.hostname}`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function refuse(message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.terminal = true;
  return err;
}

function modeOf(creds) {
  const raw = String(creds?.apiMode || '').trim().toLowerCase();
  if (raw === 'sandbox' || raw === 'test') return 'sandbox';
  if (raw === 'live' || raw === 'production') return 'live';
  return '';
}

function withApiMode(creds) {
  const apiMode = modeOf(creds);
  return apiMode ? { ...creds, apiMode } : { ...creds };
}

function host(creds) {
  const custom = String(creds?.apiBaseUrl || '').trim().replace(/\/$/, '');
  if (custom) return custom;
  return DEFAULT_HOST;
}

function assertCreds(creds) {
  const missing = [
    ['email', 'Email'],
    ['password', 'Password'],
    ['apiKey', 'API key'],
    ['userId', 'User ID'],
    ['accountTenantId', 'Tenant ID'],
  ].filter(([key]) => !String(creds?.[key] || '').trim()).map(([, label]) => label);
  if (missing.length) {
    throw refuse(`Shree Maruti was not called. The ${missing.join(', ')} is missing in Settings › Couriers › Shree Maruti.`);
  }
  if (!modeOf(creds)) {
    throw refuse('Shree Maruti was not called. Set API environment to live or sandbox in Settings › Couriers › Shree Maruti.');
  }
}

function parseJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function detailOf(text) {
  const json = parseJson(text);
  if (json.message) return String(json.message);
  if (json.error) return String(typeof json.error === 'string' ? json.error : json.error.message || JSON.stringify(json.error));
  if (json.errors?.message) return String(json.errors.message);
  const raw = String(text || '').trim();
  return raw.slice(0, 240);
}

function pick(obj, keys) {
  for (const key of keys) {
    const parts = key.split('.');
    let cur = obj;
    for (const part of parts) {
      if (cur == null) { cur = undefined; break; }
      cur = cur[part];
    }
    if (cur != null && String(cur).trim()) return cur;
  }
  return '';
}

/** Docs: gateway routes accept `api-key` header instead of Bearer + tenantid. */
function authHeaders(creds, { json = false } = {}) {
  return {
    Accept: 'application/json',
    'api-key': String(creds.apiKey).trim(),
    tenantid: String(creds.accountTenantId).trim(),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function session(creds, opts = {}) {
  assertCreds(creds);
  const gated = withApiMode(creds);
  const request = gatedRequest(gated, opts.request, httpCall, { allowSandbox: true });
  return async (what, method, path, body) => {
    const res = await request(method, `${host(gated)}${path}`, {
      headers: authHeaders(gated, { json: body !== undefined }),
      ...(body !== undefined ? { body } : {}),
    });
    if (res.status < 200 || res.status >= 300) {
      const err = new Error(`Shree Maruti ${what} returned ${res.status}. ${detailOf(res.text) || 'Nothing was saved.'}`);
      err.statusCode = [400, 401, 403, 404].includes(res.status) ? 400 : 502;
      err.terminal = err.statusCode === 400;
      throw err;
    }
    return { json: parseJson(res.text), res };
  };
}

function labelBuffer(content) {
  if (!content) return null;
  if (Buffer.isBuffer(content)) return content.slice(0, 4).toString() === '%PDF' ? content : null;
  const text = String(content).trim();
  if (!text) return null;
  if (text.startsWith('%PDF')) return Buffer.from(text);
  try {
    const bytes = Buffer.from(text.replace(/^data:application\/pdf;base64,/, ''), 'base64');
    return bytes.slice(0, 4).toString() === '%PDF' ? bytes : null;
  } catch {
    return null;
  }
}

async function downloadLabel(url, request) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const res = await request('GET', String(url), { headers: { Accept: 'application/pdf,*/*' } });
  if (res.status < 200 || res.status >= 300) return null;
  const bytes = Buffer.isBuffer(res.buffer) ? res.buffer : Buffer.from(res.text || '', 'binary');
  return bytes.slice(0, 4).toString() === '%PDF' ? bytes : labelBuffer(res.text);
}

function labelUrlOf(obj) {
  return String(pick(obj, [
    'shippingLabelUrl', 'shipping_label_url', 'labelUrl', 'label_url',
    'shipping_label_url', 'label_link', 'url',
  ]) || '').trim();
}

function kg(weightGrams) {
  return Math.max(0.1, Math.round((Number(weightGrams) || 0) / 100) / 10);
}

function addr(type, party = {}) {
  const street = String(party.line1 || party.address1 || party.address || party.street || '').trim();
  return {
    type,
    zip: String(party.pincode || party.zip || '').trim(),
    name: String(party.name || '').trim() || 'Customer',
    phone: String(party.phone || '').replace(/\D/g, '').slice(-10),
    email: party.email || undefined,
    street,
    landmark: String(party.address2 || party.landmark || '').trim() || undefined,
    city: String(party.city || '').trim(),
    state: String(party.state || '').trim(),
    country: String(party.country || 'India').trim() || 'India',
    addressName: street || String(party.addressName || '').trim(),
  };
}

/** Create a Shree Maruti / Innofulfill ECOMM shipment and return AWB + label PDF when available. */
async function book(creds, shipment, opts = {}) {
  assertCreds(creds);
  if (!(shipment.weightGrams > 0 && shipment.lengthCm > 0 && shipment.breadthCm > 0 && shipment.heightCm > 0)) {
    throw refuse('Package weight and size are missing for this order. Set them on the order items or in Settings › Package defaults. Shree Maruti was not called.');
  }
  const pincode = String(shipment.pincode || '').trim();
  if (!/^\d{6}$/.test(pincode)) throw refuse('This order has no 6-digit delivery pincode, so Shree Maruti was not called.');
  const pickup = shipment.pickup || {};
  const pickupPin = String(pickup.pincode || '').trim();
  if (!/^\d{6}$/.test(pickupPin)) throw refuse('WH-001 needs a 6-digit pincode before Shree Maruti is called.');
  const cod = shipment.paymentMode === 'COD';
  const call = await session(creds, opts);
  const weightKg = kg(shipment.weightGrams);
  const parcelCategory = String(creds.parcelCategory || 'ECOMM').trim().toUpperCase() || 'ECOMM';
  const orderType = String(creds.orderType || 'FORWARD').trim().toUpperCase() || 'FORWARD';
  const deliveryMode = String(creds.deliveryMode || shipment.mode || 'SURFACE').trim().toUpperCase() || 'SURFACE';
  const referenceId = String(shipment.orderNo || shipment.reference || '').trim();
  const { json } = await call('create order', 'POST', '/gateway/booking-service/orders', {
    referenceId: referenceId || undefined,
    amount: Number(shipment.codAmount || shipment.orderValue || 0) || 0,
    orderDate: new Date().toISOString(),
    orderType,
    orderStatus: 'CONFIRMED',
    parcelCategory,
    deliveryPromise: parcelCategory,
    deliveryMode: deliveryMode === 'AIR' ? 'AIR' : 'SURFACE',
    autoManifest: false,
    addresses: [
      addr('PICKUP', pickup),
      addr('DELIVERY', {
        name: shipment.name || shipment.customerName,
        phone: shipment.phone,
        email: shipment.email,
        address: shipment.address || shipment.address1,
        address2: shipment.address2,
        city: shipment.city,
        state: shipment.state,
        pincode,
        country: shipment.country,
      }),
      addr('BILLING', {
        name: shipment.name || shipment.customerName,
        phone: shipment.phone,
        email: shipment.email,
        address: shipment.address || shipment.address1,
        address2: shipment.address2,
        city: shipment.city,
        state: shipment.state,
        pincode,
        country: shipment.country,
      }),
      addr('RETURN', pickup),
    ],
    shipments: [{
      dimensions: {
        length: Number(shipment.lengthCm),
        width: Number(shipment.breadthCm),
        height: Number(shipment.heightCm),
      },
      shipmentStatus: 'CONFIRMED',
      physicalWeight: weightKg,
      physicalWeightUnit: 'KG',
      items: (Array.isArray(shipment.items) && shipment.items.length
        ? shipment.items
        : [{ name: shipment.description || 'Item', qty: shipment.quantity || 1, price: shipment.amount || 0 }]
      ).map((item) => ({
        name: item.name || item.sku || 'Item',
        quantity: Number(item.qty || item.quantity || 1) || 1,
        unitPrice: Number(item.price || 0) || 0,
        sku: item.sku || undefined,
      })),
    }],
    payment: {
      type: cod ? 'COD' : 'PREPAID',
      currency: 'INR',
      paymentMethod: cod ? 'COD' : 'ONLINE',
    },
    metadata: { source: 'omsking', orderNo: referenceId || undefined },
  });
  const data = json.data || json.result || json;
  const shipmentRow = Array.isArray(data.shipments) ? data.shipments[0] : data.shipments;
  const awb = String(pick(shipmentRow || data, ['awbNumber', 'awb', 'awb_number', 'tracking_number', 'trackingNumber', 'waybill']) || '').trim();
  const shipmentId = String(pick(data, ['orderId', 'order_id', 'shipment_id', 'shipmentId', 'id']) || awb).trim();
  if (!awb) throw refuse(`Shree Maruti did not return an AWB. ${detailOf(JSON.stringify(json)) || 'Nothing was booked.'}`);

  let labelPdf = labelBuffer(pick(data, ['label_base64', 'labelBase64', 'label_pdf', 'labelPdf', 'label']));
  let labelUrl = labelUrlOf(data);
  if (!labelPdf && shipmentId) {
    try {
      const labelRes = await call('label', 'POST', '/gateway/pdf-generator/shipping-label', {
        orderId: shipmentId,
        tenantId: String(creds.accountTenantId).trim(),
        userId: String(creds.userId).trim(),
      });
      const labelData = labelRes.json.data || labelRes.json.result || labelRes.json;
      labelPdf = labelBuffer(typeof labelData === 'string' ? labelData : pick(labelData, ['pdf', 'label', 'base64', 'content']));
      if (!labelPdf && labelRes.res?.headers?.['content-type']?.includes('pdf')) {
        labelPdf = labelBuffer(labelRes.res.buffer || labelRes.res.text);
      }
      if (!labelUrl) labelUrl = labelUrlOf(typeof labelData === 'object' ? labelData : {});
    } catch {
      /* label is best-effort; AWB is already booked */
    }
  }
  if (!labelPdf && labelUrl) {
    const gated = withApiMode(creds);
    const request = gatedRequest(gated, opts.request, httpCall, { allowSandbox: true });
    labelPdf = await downloadLabel(labelUrl, request);
  }
  return {
    awb,
    shipmentId,
    paymentMode: cod ? 'COD' : 'Prepaid',
    labelPdf,
  };
}

async function cancel(creds, { awb, shipmentId } = {}, opts = {}) {
  const id = String(shipmentId || '').trim();
  if (!id) throw refuse('Shree Maruti cancel needs an Innofulfill order ID.');
  const call = await session(creds, opts);
  await call('cancel', 'POST', '/gateway/booking-service/orders/cancel/bulk', {
    orders: [{ orderId: id, reason: 'Cancelled from OMSKing' }],
  });
  return { cancelled: true, awb: String(awb || '').trim() || id, shipmentId: id };
}

const SCAN_STATUS = [
  [/rto|return[_\s-]?to[_\s-]?origin|returned/i, 'rto'],
  [/undeliver|consignee|refused|not available|ndr|delivery attempt/i, 'ndr'],
  [/out[_\s-]?for[_\s-]?delivery/i, 'out_for_delivery'],
  [/delivered/i, 'delivered'],
  [/transit|arrived|departed|hub|in scan|reached|processing|ready[_\s-]?for[_\s-]?dispatch/i, 'in_transit'],
  [/picked|pickup|manifest|confirmed|order[_\s-]?created/i, 'picked_up'],
];

function mapScanStatus(text) {
  const value = String(text || '').replace(/_/g, ' ');
  for (const [re, status] of SCAN_STATUS) {
    if (re.test(value)) return status;
  }
  return '';
}

/** Tracking events in the Delhivery-compatible { status, detail, eventKey } shape. */
async function track(creds, awb, opts = {}) {
  const tracking = String(awb || '').trim();
  if (!tracking) throw refuse('Shree Maruti tracking needs an AWB.');
  const call = await session(creds, opts);
  const { json } = await call('tracking', 'GET', `/gateway/tracking-v2/api/tracking/awb/${encodeURIComponent(tracking)}`);
  // Live Innofulfill returns { orderInformation, statuses } at the top level — do not dig into
  // orderInformation first or the statuses array is missed and every poll stays empty.
  const data = json.data || json.result || json;
  const info = data.orderInformation || json.orderInformation || {};
  const scans = data.statuses || json.statuses || info.statuses || data.scans || data.history
    || data.tracking_history || data.events || data.trackingHistory || data.partnerTracking
    || info.partnerTracking || [];
  const list = Array.isArray(scans) ? scans : [];
  const events = list.map((row) => {
    const detail = String(
      row.status || row.category || row.statusName || row.scan || row.Scan
      || row.message || row.remark || row.event || row.subcategory || '',
    );
    const status = mapScanStatus(detail || row.status_code || row.code || row.provider_status);
    if (!status) return null;
    const when = row.statusTimestamp || row.time || row.datetime || row.date || row.timestamp
      || row.createdAt || row.ScanDateTime || status;
    return { status, detail, eventKey: `${tracking}:${when}:${status}` };
  }).filter(Boolean);
  if (!events.length) {
    const detail = String(
      info.currentShipmentPhase || data.currentShipmentPhase
      || data.status || data.current_status || data.shipment_status || data.currentStatus || data.orderStatus || '',
    );
    const status = mapScanStatus(detail);
    if (status) events.push({ status, detail, eventKey: `${tracking}:${status}:current` });
  }
  return { status: events.at(-1)?.status || '', events };
}

/** Read-only serviceability check (no shipment). */
async function checkServiceability(creds, { fromPincode, toPincode, paymentMode = 'PREPAID' } = {}, opts = {}) {
  assertCreds(creds);
  const call = await session(creds, opts);
  const { json } = await call('serviceability', 'POST', '/gateway/serviceability/ecomm', {
    fromPincode: Number(fromPincode),
    toPincode: Number(toPincode),
    paymentMode: paymentMode === 'COD' ? 'COD' : 'PREPAID',
    operationType: 'PICKUP_DELIVERY',
    carriers: ['SMILE'],
  });
  return json;
}

module.exports = {
  book,
  cancel,
  track,
  checkServiceability,
  host,
  modeOf,
  mapScanStatus,
  httpCall,
  DEFAULT_HOST,
};
