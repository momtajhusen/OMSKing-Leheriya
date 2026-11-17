const https = require('https');
const { URL } = require('url');
const { gatedRequest } = require('../../liveGate');

/** Default Innofulfill / Shree Maruti host. Override with credentials.apiBaseUrl when the merchant pack names another host. */
const DEFAULT_HOST = 'https://api.innofulfill.com';

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
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
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
  const msg = json.message || json.error || json.Message || json.msg
    || json.data?.message || json.errors?.[0]?.message || json.errors?.[0];
  if (msg) return String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 240);
  return String(text || '').trim().slice(0, 240);
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

async function accessToken(creds, request) {
  const res = await request('POST', `${host(creds)}/api/v1/auth/login`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: {
      email: String(creds.email).trim(),
      password: String(creds.password).trim(),
      api_key: String(creds.apiKey).trim(),
      user_id: String(creds.userId).trim(),
      tenant_id: String(creds.accountTenantId).trim(),
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw refuse(`Shree Maruti login returned ${res.status}. ${detailOf(res.text) || 'Check email, password, and API key.'}`);
  }
  const json = parseJson(res.text);
  const token = String(pick(json, ['token', 'access_token', 'accessToken', 'data.token', 'data.access_token', 'Bearer Token']) || '').trim();
  if (!token) throw refuse('Shree Maruti login sent no access token. Nothing was booked.');
  return token;
}

async function session(creds, opts = {}) {
  assertCreds(creds);
  const gated = withApiMode(creds);
  const request = gatedRequest(gated, opts.request, httpCall, { allowSandbox: true });
  const token = await accessToken(gated, request);
  return async (what, method, path, body) => {
    const res = await request(method, `${host(gated)}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-key': String(gated.apiKey).trim(),
        'x-user-id': String(gated.userId).trim(),
        'x-tenant-id': String(gated.accountTenantId).trim(),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
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
  const bytes = Buffer.from(res.text || '', 'binary');
  return bytes.slice(0, 4).toString() === '%PDF' ? bytes : labelBuffer(res.text);
}

function kg(weightGrams) {
  return Math.max(0.1, Math.round((Number(weightGrams) || 0) / 100) / 10);
}

/** Create a Shree Maruti / Innofulfill shipment and return AWB + label PDF when the API sends one. */
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
  const { json } = await call('create order', 'POST', '/api/v1/orders', {
    order_id: String(shipment.orderNo),
    order_type: String(creds.orderType || 'Forward').trim() || 'Forward',
    parcel_category: String(creds.parcelCategory || 'Ecomm').trim() || 'Ecomm',
    payment_mode: cod ? 'COD' : 'Prepaid',
    cod_amount: cod ? Math.round((Number(shipment.codAmount ?? shipment.amount) || 0) * 100) / 100 : 0,
    order_amount: Math.round((Number(shipment.amount) || 0) * 100) / 100,
    consignee: {
      name: String(shipment.name || 'Customer').slice(0, 50),
      address: String(shipment.address || '').slice(0, 200),
      city: String(shipment.city || ''),
      state: String(shipment.state || ''),
      pincode,
      phone: String(shipment.phone || '').replace(/\D/g, '').slice(-10),
      email: shipment.email || undefined,
    },
    pickup: {
      name: String(pickup.name || 'Shipper').slice(0, 50),
      address: String(pickup.line1 || pickup.address || '').slice(0, 200),
      city: String(pickup.city || ''),
      state: String(pickup.state || ''),
      pincode: pickupPin,
      phone: String(pickup.phone || '').replace(/\D/g, '').slice(-10),
    },
    package: {
      weight_kg: kg(shipment.weightGrams),
      length_cm: Number(shipment.lengthCm) || 1,
      breadth_cm: Number(shipment.breadthCm) || 1,
      height_cm: Number(shipment.heightCm) || 1,
      quantity: Math.max(1, Number(shipment.quantity) || 1),
      description: String(shipment.description || shipment.orderNo).slice(0, 200),
    },
  });
  const data = json.data || json.result || json;
  const awb = String(pick(data, ['awb', 'awb_number', 'awbNumber', 'tracking_number', 'trackingNumber', 'waybill']) || '').trim();
  const shipmentId = String(pick(data, ['order_id', 'orderId', 'shipment_id', 'shipmentId', 'id']) || awb).trim();
  if (!awb) throw refuse(`Shree Maruti did not return an AWB. ${detailOf(JSON.stringify(json)) || 'Nothing was booked.'}`);
  let labelPdf = labelBuffer(pick(data, ['label_base64', 'labelBase64', 'label_pdf', 'labelPdf', 'label']));
  const labelUrl = String(pick(data, ['label_url', 'labelUrl', 'shipping_label_url', 'label_link']) || '').trim();
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
  const tracking = String(awb || '').trim();
  const id = String(shipmentId || tracking).trim();
  if (!tracking && !id) throw refuse('Shree Maruti cancel needs an AWB.');
  const call = await session(creds, opts);
  await call('cancel', 'POST', '/api/v1/orders/cancel', {
    awb: tracking || undefined,
    order_id: id || undefined,
  });
  return { cancelled: true, awb: tracking || id };
}

const SCAN_STATUS = [
  [/rto|return to origin|returned/i, 'rto'],
  [/undeliver|consignee|refused|not available|ndr|delivery attempt/i, 'ndr'],
  [/out for delivery/i, 'out_for_delivery'],
  [/delivered/i, 'delivered'],
  [/transit|arrived|departed|hub|in scan|reached/i, 'in_transit'],
  [/picked|pickup|manifest/i, 'picked_up'],
];

function mapScanStatus(text) {
  const value = String(text || '');
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
  const { json } = await call('tracking', 'GET', `/api/v1/tracking/${encodeURIComponent(tracking)}`);
  const data = json.data || json.result || json;
  const scans = data.scans || data.history || data.tracking_history || data.events || [];
  const list = Array.isArray(scans) ? scans : [];
  const events = list.map((row) => {
    const detail = String(row.status || row.scan || row.Scan || row.message || row.remark || '');
    const status = mapScanStatus(detail || row.status_code || row.code);
    if (!status) return null;
    const when = row.time || row.datetime || row.date || row.ScanDateTime || status;
    return { status, detail, eventKey: `${tracking}:${when}:${status}` };
  }).filter(Boolean);
  if (!events.length) {
    const status = mapScanStatus(data.status || data.current_status || data.shipment_status);
    if (status) events.push({ status, detail: String(data.status || data.current_status || ''), eventKey: `${tracking}:${status}:current` });
  }
  return { status: events.at(-1)?.status || '', events };
}

module.exports = {
  book,
  cancel,
  track,
  host,
  modeOf,
  mapScanStatus,
  httpCall,
  DEFAULT_HOST,
};
