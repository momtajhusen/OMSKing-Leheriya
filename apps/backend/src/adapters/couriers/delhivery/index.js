const https = require('https');
const { URL } = require('url');
const { gatedRequest } = require('../../liveGate');

const HOST = 'https://track.delhivery.com';

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
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
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

function authHeaders(token) {
  return { Authorization: `Token ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
}

function requireToken(creds) {
  const token = String(creds?.apiToken || '').trim();
  if (!token) {
    const err = new Error('Delhivery was not called. The API token is missing.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  return token;
}

function parseJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

async function serviceable(creds, opts = {}) {
  const { pincode, paymentMode } = opts;
  const token = requireToken(creds);
  const request = gatedRequest(creds, opts.request, httpCall);
  const pin = String(pincode || '').trim();
  const res = await request('GET', `${HOST}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pin)}`, {
    headers: authHeaders(token),
  });
  const row = parseJson(res.text).delivery_codes?.[0]?.postal_code;
  const cod = String(paymentMode || '').toUpperCase() === 'COD';
  const ok = res.status >= 200 && res.status < 300 && row && (cod ? row.cash === 'Y' : row.pre_paid === 'Y');
  if (!ok) {
    const err = new Error(`Delhivery cannot deliver pincode ${pin || '(missing)'}. No AWB was booked.`);
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  return { pincode: pin };
}

async function book(creds, shipment, opts = {}) {
  const token = requireToken(creds);
  const warehouse = String(creds.pickupWarehouse || '').trim();
  if (!warehouse) {
    const err = new Error('Delhivery was not called. Pickup warehouse name is missing.');
    err.statusCode = 400;
    err.terminal = true;
    throw err;
  }
  const request = gatedRequest(creds, opts.request, httpCall);
  const payload = JSON.stringify({
    shipments: [{
      name: shipment.name,
      add: shipment.address,
      pin: shipment.pincode,
      city: shipment.city,
      state: shipment.state,
      phone: shipment.phone,
      order: shipment.orderNo,
      payment_mode: shipment.paymentMode === 'COD' ? 'COD' : (shipment.paymentMode === 'Pickup' ? 'Pickup' : 'Prepaid'),
      products_desc: shipment.description,
      quantity: shipment.quantity,
      total_amount: shipment.amount,
      seller_add: shipment.pickupAddress,
      seller_name: creds.clientName || warehouse,
    }],
    pickup_location: { name: warehouse },
  });
  const res = await request('POST', `${HOST}/api/cmu/create.json`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `format=json&data=${encodeURIComponent(payload)}`,
  });
  const pack = parseJson(res.text).packages?.[0] || {};
  const waybill = String(pack.waybill || '').trim();
  if (res.status < 200 || res.status >= 300 || !waybill || /fail/i.test(String(pack.status || ''))) {
    const err = new Error(`Delhivery did not return an AWB. ${pack.remarks || pack.status || res.status}`);
    err.statusCode = 502;
    throw err;
  }
  return { awb: waybill };
}

async function bookReturn(creds, shipment, opts) {
  return book(creds, { ...shipment, paymentMode: 'Pickup' }, opts);
}

async function labelPdf(creds, awb, opts = {}) {
  const token = requireToken(creds);
  const request = gatedRequest(creds, opts.request, httpCall);
  const res = await request('GET', `${HOST}/api/p/packing_slip?wbns=${encodeURIComponent(awb)}&pdf=true`, {
    headers: authHeaders(token),
  });
  const bytes = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text || '');
  if (res.status < 200 || res.status >= 300 || !bytes.slice(0, 4).toString().startsWith('%PDF')) {
    const err = new Error('Delhivery did not return a label PDF.');
    err.statusCode = 502;
    throw err;
  }
  return bytes;
}

async function requestPickup(creds, opts = {}) {
  const { count } = opts;
  const token = requireToken(creds);
  const request = gatedRequest(creds, opts.request, httpCall);
  const res = await request('POST', `${HOST}/fm/request/new/`, {
    headers: authHeaders(token),
    body: {
      pickup_location: creds.pickupWarehouse,
      pickup_date: new Date().toISOString().slice(0, 10),
      pickup_time: '16:00:00',
      expected_package_count: count,
    },
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Delhivery pickup was not created (${res.status}).`);
    err.statusCode = 502;
    throw err;
  }
  return { count };
}

async function cancelAwb(creds, awb, opts = {}) {
  const token = requireToken(creds);
  const request = gatedRequest(creds, opts.request, httpCall);
  const res = await request('POST', `${HOST}/api/p/edit`, {
    headers: authHeaders(token),
    body: { waybill: awb, cancellation: 'true' },
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Delhivery did not cancel AWB ${awb}.`);
    err.statusCode = 502;
    throw err;
  }
  return { awb };
}

function mapScanStatus(text) {
  const value = String(text || '').toLowerCase();
  if (!value) return '';
  if (value.includes('rto') || value.includes('return to origin')) return 'rto';
  if (value.includes('ndr') || value.includes('consignee') || value.includes('undelivered') || value.includes('not available')) return 'ndr';
  if (value.includes('out for delivery')) return 'out_for_delivery';
  if (value.includes('delivered')) return 'delivered';
  if (value.includes('transit')) return 'in_transit';
  if (value.includes('pick') || value.includes('manifest')) return 'picked_up';
  return '';
}

async function trackShipment(creds, awb, opts = {}) {
  const token = requireToken(creds);
  const request = gatedRequest(creds, opts.request, httpCall);
  const res = await request('GET', `${HOST}/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`, {
    headers: authHeaders(token),
  });
  const body = parseJson(res.text);
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Delhivery tracking returned ${res.status}.`);
    err.statusCode = 502;
    throw err;
  }
  const shipment = body.ShipmentData?.[0]?.Shipment || {};
  const scans = Array.isArray(shipment.Scans) ? shipment.Scans : [];
  const events = scans.map((scan) => {
    const row = scan.ScanDetail || scan;
    const status = mapScanStatus(row.Scan || row.Instructions || '');
    if (!status) return null;
    return {
      status,
      detail: String(row.Instructions || row.Scan || ''),
      eventKey: `${awb}:${row.ScanDateTime || row.Scan || status}:${status}`,
    };
  }).filter(Boolean);
  if (!events.length) {
    const status = mapScanStatus(shipment.Status?.Status || '');
    if (status) events.push({ status, detail: String(shipment.Status?.Status || ''), eventKey: `${awb}:${status}:current` });
  }
  return events;
}

async function ndrAction(creds, payload, opts = {}) {
  const { awb, act, phone, address } = payload || {};
  const token = requireToken(creds);
  const request = gatedRequest(creds, opts.request, httpCall);
  const res = await request('POST', `${HOST}/api/p/update`, {
    headers: authHeaders(token),
    body: { data: [{ waybill: awb, act, phone: phone || '', add: address || '' }] },
  });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Delhivery did not accept the NDR action (${res.status}).`);
    err.statusCode = 502;
    throw err;
  }
  return { awb, act };
}

module.exports = {
  name: 'delhivery',
  serviceable,
  book,
  bookReturn,
  labelPdf,
  requestPickup,
  cancelAwb,
  trackShipment,
  ndrAction,
  mapScanStatus,
};
